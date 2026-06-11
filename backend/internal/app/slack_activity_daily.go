package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// SlackChannelDayCounts captures per-user message counts in one channel for one UTC day.
type SlackChannelDayCounts struct {
	ChannelID   string         `json:"channelId"`
	ChannelName string         `json:"channelName,omitempty"`
	IsPrivate   bool           `json:"isPrivate"`
	IsIM        bool           `json:"isIm"`
	IsMPIM      bool           `json:"isMpim"`
	Messages    int            `json:"messages"`
	ByUser      map[string]int `json:"byUser"`
}

// SlackActivityDay is the aggregated per-channel + per-user message count for one UTC day.
type SlackActivityDay struct {
	Day             string                  `json:"day"` // YYYY-MM-DD UTC
	FetchedAt       string                  `json:"fetchedAt"`
	ChannelsScanned int                     `json:"channelsScanned"`
	ChannelsSkipped int                     `json:"channelsSkipped"`
	MessagesTotal   int                     `json:"messagesTotal"`
	UniqueUsers     int                     `json:"uniqueUsers"`
	ByUser          map[string]int          `json:"byUser"`
	Channels        []SlackChannelDayCounts `json:"channels"`
	Note            string                  `json:"note,omitempty"`
}

const (
	slackConversationsListURL    = "https://slack.com/api/users.conversations"
	slackConversationsHistoryURL = "https://slack.com/api/conversations.history"
	slackActivityPageLimit       = 200
	slackActivityHistoryLimit    = 200
	slackActivityMaxChanPages    = 20
	slackActivityMaxHistPages    = 25
	slackActivityPagePause       = 350 * time.Millisecond
	slackActivityHTTPTimeout     = 90 * time.Second
)

type slackConversationsListResponse struct {
	OK       bool   `json:"ok"`
	Error    string `json:"error"`
	Channels []struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		IsPrivate bool   `json:"is_private"`
		IsIM      bool   `json:"is_im"`
		IsMPIM    bool   `json:"is_mpim"`
		IsMember  bool   `json:"is_member"`
		IsArchived bool  `json:"is_archived"`
		User      string `json:"user"` // counterparty for IMs
	} `json:"channels"`
	ResponseMetadata struct {
		NextCursor string `json:"next_cursor"`
	} `json:"response_metadata"`
}

type slackConversationsHistoryResponse struct {
	OK       bool   `json:"ok"`
	Error    string `json:"error"`
	HasMore  bool   `json:"has_more"`
	Messages []struct {
		Type    string `json:"type"`
		Subtype string `json:"subtype"`
		User    string `json:"user"`
		BotID   string `json:"bot_id"`
		Ts      string `json:"ts"`
	} `json:"messages"`
	ResponseMetadata struct {
		NextCursor string `json:"next_cursor"`
	} `json:"response_metadata"`
}

// FetchSlackActivityDay walks every conversation the bot is a member of and counts non-bot human
// messages per user for the UTC day at `day` (YYYY-MM-DD). Threaded replies are not walked here —
// channel-history yields parent messages; that matches "active that day" without double-counting
// thread replies posted on a later day. Counts respect Slack tier-3 limits (history is tier-3,
// users.conversations is tier-2); each page is paced to stay well under both ceilings.
func FetchSlackActivityDay(ctx context.Context, botToken, day string) (SlackActivityDay, error) {
	botToken = strings.TrimSpace(botToken)
	if botToken == "" {
		return SlackActivityDay{}, errors.New("missing slack bot token")
	}
	day = strings.TrimSpace(day)
	if day == "" {
		day = time.Now().UTC().Add(-24 * time.Hour).Format("2006-01-02")
	}
	dayStart, err := time.ParseInLocation("2006-01-02", day, time.UTC)
	if err != nil {
		return SlackActivityDay{}, fmt.Errorf("parse day %q: %w", day, err)
	}
	oldest := dayStart.Unix()
	latest := dayStart.Add(24 * time.Hour).Unix()

	client := &http.Client{Timeout: slackActivityHTTPTimeout}
	channels, err := fetchSlackBotConversations(ctx, client, botToken)
	if err != nil {
		return SlackActivityDay{}, err
	}

	out := SlackActivityDay{
		Day:    day,
		ByUser: map[string]int{},
	}
	for _, c := range channels {
		if c.IsArchived {
			out.ChannelsSkipped++
			continue
		}
		counts, hErr := fetchSlackChannelDayCounts(ctx, client, botToken, c.ID, oldest, latest)
		if hErr != nil {
			// Don't fail the whole sweep on one channel — record skip and keep going.
			out.ChannelsSkipped++
			continue
		}
		out.ChannelsScanned++
		out.MessagesTotal += counts.Messages
		ch := SlackChannelDayCounts{
			ChannelID:   c.ID,
			ChannelName: c.Name,
			IsPrivate:   c.IsPrivate,
			IsIM:        c.IsIM,
			IsMPIM:      c.IsMPIM,
			Messages:    counts.Messages,
			ByUser:      counts.ByUser,
		}
		out.Channels = append(out.Channels, ch)
		for u, n := range counts.ByUser {
			out.ByUser[u] += n
		}
	}
	out.UniqueUsers = len(out.ByUser)
	out.FetchedAt = time.Now().UTC().Format(time.RFC3339)
	out.Note = "Counts root messages per channel for the UTC day; bot-authored messages excluded; thread replies not walked."
	sort.Slice(out.Channels, func(i, j int) bool { return out.Channels[i].Messages > out.Channels[j].Messages })
	return out, nil
}

type slackBotChannel struct {
	ID         string
	Name       string
	IsPrivate  bool
	IsIM       bool
	IsMPIM     bool
	IsArchived bool
}

func fetchSlackBotConversations(ctx context.Context, client *http.Client, botToken string) ([]slackBotChannel, error) {
	var out []slackBotChannel
	cursor := ""
	for page := 0; page < slackActivityMaxChanPages; page++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		form := url.Values{}
		form.Set("limit", strconv.Itoa(slackActivityPageLimit))
		form.Set("types", "public_channel,private_channel,mpim,im")
		form.Set("exclude_archived", "true")
		if cursor != "" {
			form.Set("cursor", cursor)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, slackConversationsListURL, strings.NewReader(form.Encode()))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("Authorization", "Bearer "+botToken)
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		_ = resp.Body.Close()
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			observeSlackUpstreamStatus("slack users.conversations", resp.StatusCode)
			return nil, &UpstreamHTTPError{
				Source:      "slack users.conversations",
				StatusCode:  resp.StatusCode,
				RetryAfter:  strings.TrimSpace(resp.Header.Get("Retry-After")),
				BodySnippet: strings.TrimSpace(string(snippetBytes(body, 300))),
			}
		}
		var parsed slackConversationsListResponse
		if err := json.Unmarshal(body, &parsed); err != nil {
			return nil, fmt.Errorf("slack users.conversations json: %w", err)
		}
		if !parsed.OK {
			if parsed.Error != "" {
				return nil, fmt.Errorf("slack users.conversations: %s", parsed.Error)
			}
			return nil, errors.New("slack users.conversations: not ok")
		}
		for _, c := range parsed.Channels {
			out = append(out, slackBotChannel{
				ID:         strings.TrimSpace(c.ID),
				Name:       strings.TrimSpace(c.Name),
				IsPrivate:  c.IsPrivate,
				IsIM:       c.IsIM,
				IsMPIM:     c.IsMPIM,
				IsArchived: c.IsArchived,
			})
		}
		cursor = strings.TrimSpace(parsed.ResponseMetadata.NextCursor)
		if cursor == "" {
			break
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(slackActivityPagePause):
		}
	}
	return out, nil
}

type channelDayCounts struct {
	Messages int
	ByUser   map[string]int
}

func fetchSlackChannelDayCounts(ctx context.Context, client *http.Client, botToken, channelID string, oldest, latest int64) (channelDayCounts, error) {
	res := channelDayCounts{ByUser: map[string]int{}}
	cursor := ""
	for page := 0; page < slackActivityMaxHistPages; page++ {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		form := url.Values{}
		form.Set("channel", channelID)
		form.Set("oldest", strconv.FormatInt(oldest, 10))
		form.Set("latest", strconv.FormatInt(latest, 10))
		form.Set("inclusive", "false")
		form.Set("limit", strconv.Itoa(slackActivityHistoryLimit))
		if cursor != "" {
			form.Set("cursor", cursor)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, slackConversationsHistoryURL, strings.NewReader(form.Encode()))
		if err != nil {
			return res, err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("Authorization", "Bearer "+botToken)
		resp, err := client.Do(req)
		if err != nil {
			return res, err
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		_ = resp.Body.Close()
		if err != nil {
			return res, err
		}
		if resp.StatusCode != http.StatusOK {
			observeSlackUpstreamStatus("slack conversations.history", resp.StatusCode)
			return res, &UpstreamHTTPError{
				Source:      "slack conversations.history",
				StatusCode:  resp.StatusCode,
				RetryAfter:  strings.TrimSpace(resp.Header.Get("Retry-After")),
				BodySnippet: strings.TrimSpace(string(snippetBytes(body, 300))),
			}
		}
		var parsed slackConversationsHistoryResponse
		if err := json.Unmarshal(body, &parsed); err != nil {
			return res, fmt.Errorf("slack conversations.history json: %w", err)
		}
		if !parsed.OK {
			if parsed.Error != "" {
				return res, fmt.Errorf("slack conversations.history: %s", parsed.Error)
			}
			return res, errors.New("slack conversations.history: not ok")
		}
		for _, m := range parsed.Messages {
			if !isCountableSlackMessage(m.Type, m.Subtype, m.User, m.BotID) {
				continue
			}
			u := strings.TrimSpace(m.User)
			res.Messages++
			res.ByUser[u]++
		}
		cursor = strings.TrimSpace(parsed.ResponseMetadata.NextCursor)
		if !parsed.HasMore || cursor == "" {
			break
		}
		select {
		case <-ctx.Done():
			return res, ctx.Err()
		case <-time.After(slackActivityPagePause):
		}
	}
	return res, nil
}

// isCountableSlackMessage drops bot posts, channel join/leave noise, and edits. A countable message
// is a real human root post with a user id and no bot_id.
func isCountableSlackMessage(msgType, subtype, user, botID string) bool {
	if strings.TrimSpace(msgType) != "message" {
		return false
	}
	if strings.TrimSpace(user) == "" {
		return false
	}
	if strings.TrimSpace(botID) != "" {
		return false
	}
	switch strings.TrimSpace(subtype) {
	case "":
		return true
	case "thread_broadcast":
		return true
	}
	return false
}
