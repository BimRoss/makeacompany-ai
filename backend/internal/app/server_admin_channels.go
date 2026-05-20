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
	"strings"
	"time"
)

// SlackChannel is one Slack conversation the workspace bot is a member of.
type SlackChannel struct {
	ChannelID  string `json:"channelId"`
	Name       string `json:"name"`
	IsPrivate  bool   `json:"isPrivate"`
	IsArchived bool   `json:"isArchived"`
	NumMembers int    `json:"numMembers,omitempty"`
}

type slackUsersConversationsResponse struct {
	OK       bool   `json:"ok"`
	Error    string `json:"error"`
	Channels []struct {
		ID         string `json:"id"`
		Name       string `json:"name"`
		IsPrivate  bool   `json:"is_private"`
		IsArchived bool   `json:"is_archived"`
		NumMembers int    `json:"num_members"`
	} `json:"channels"`
	ResponseMetadata struct {
		NextCursor string `json:"next_cursor"`
	} `json:"response_metadata"`
}

type slackConversationsMembersResponse struct {
	OK               bool     `json:"ok"`
	Error            string   `json:"error"`
	Members          []string `json:"members"`
	ResponseMetadata struct {
		NextCursor string `json:"next_cursor"`
	} `json:"response_metadata"`
}

const (
	slackUsersConversationsURL    = "https://slack.com/api/users.conversations"
	slackConversationsMembersURL  = "https://slack.com/api/conversations.members"
	slackChannelsPageLimit        = 200
	slackChannelsMaxPages         = 20
	slackChannelsPagePause        = 300 * time.Millisecond
	slackChannelsHTTPClientTime   = 30 * time.Second
)

// FetchSlackBotChannels returns the channels the bot token's user is a member of via users.conversations.
// Public + private channels only (DMs/MPIMs filtered out by types arg).
func FetchSlackBotChannels(ctx context.Context, botToken string) ([]SlackChannel, error) {
	botToken = strings.TrimSpace(botToken)
	if botToken == "" {
		return nil, errors.New("missing slack bot token")
	}
	client := &http.Client{Timeout: slackChannelsHTTPClientTime}
	var out []SlackChannel
	cursor := ""
	for page := 0; page < slackChannelsMaxPages; page++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		form := url.Values{}
		form.Set("limit", fmt.Sprintf("%d", slackChannelsPageLimit))
		form.Set("types", "public_channel,private_channel")
		form.Set("exclude_archived", "false")
		if cursor != "" {
			form.Set("cursor", cursor)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, slackUsersConversationsURL, strings.NewReader(form.Encode()))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("Authorization", "Bearer "+botToken)
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		_ = resp.Body.Close()
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			return nil, &UpstreamHTTPError{
				Source:      "slack users.conversations",
				StatusCode:  resp.StatusCode,
				RetryAfter:  strings.TrimSpace(resp.Header.Get("Retry-After")),
				BodySnippet: strings.TrimSpace(string(snippetBytes(body, 300))),
			}
		}
		var parsed slackUsersConversationsResponse
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
			out = append(out, SlackChannel{
				ChannelID:  strings.TrimSpace(c.ID),
				Name:       strings.TrimSpace(c.Name),
				IsPrivate:  c.IsPrivate,
				IsArchived: c.IsArchived,
				NumMembers: c.NumMembers,
			})
		}
		cursor = strings.TrimSpace(parsed.ResponseMetadata.NextCursor)
		if cursor == "" {
			break
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(slackChannelsPagePause):
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// FetchSlackChannelMemberIDs returns the user IDs in a channel via paginated conversations.members.
func FetchSlackChannelMemberIDs(ctx context.Context, botToken, channelID string) ([]string, error) {
	botToken = strings.TrimSpace(botToken)
	channelID = strings.TrimSpace(channelID)
	if botToken == "" {
		return nil, errors.New("missing slack bot token")
	}
	if channelID == "" {
		return nil, errors.New("missing channel id")
	}
	client := &http.Client{Timeout: slackChannelsHTTPClientTime}
	var out []string
	cursor := ""
	for page := 0; page < slackChannelsMaxPages; page++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		form := url.Values{}
		form.Set("channel", channelID)
		form.Set("limit", fmt.Sprintf("%d", slackChannelsPageLimit))
		if cursor != "" {
			form.Set("cursor", cursor)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, slackConversationsMembersURL, strings.NewReader(form.Encode()))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("Authorization", "Bearer "+botToken)
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		_ = resp.Body.Close()
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			return nil, &UpstreamHTTPError{
				Source:      "slack conversations.members",
				StatusCode:  resp.StatusCode,
				RetryAfter:  strings.TrimSpace(resp.Header.Get("Retry-After")),
				BodySnippet: strings.TrimSpace(string(snippetBytes(body, 300))),
			}
		}
		var parsed slackConversationsMembersResponse
		if err := json.Unmarshal(body, &parsed); err != nil {
			return nil, fmt.Errorf("slack conversations.members json: %w", err)
		}
		if !parsed.OK {
			if parsed.Error != "" {
				return nil, fmt.Errorf("slack conversations.members: %s", parsed.Error)
			}
			return nil, errors.New("slack conversations.members: not ok")
		}
		for _, m := range parsed.Members {
			if id := strings.TrimSpace(m); id != "" {
				out = append(out, id)
			}
		}
		cursor = strings.TrimSpace(parsed.ResponseMetadata.NextCursor)
		if cursor == "" {
			break
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(slackChannelsPagePause):
		}
	}
	return out, nil
}

// handleAdminChannels returns channels the workspace bot is a member of (live Slack call).
func (s *Server) handleAdminChannels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ok, svcUnavail := s.adminReadOrInternalServiceAuthorized(r)
	if !ok {
		if svcUnavail {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		} else {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
		return
	}
	if strings.TrimSpace(s.cfg.SlackBotToken) == "" {
		writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": "slack bot token is not configured (ORCHESTRATOR_SLACK_BOT_TOKEN; legacy SLACK_BOT_TOKEN still accepted)"})
		return
	}
	channels, err := FetchSlackBotChannels(r.Context(), s.cfg.SlackBotToken)
	if err != nil {
		s.log.Printf("admin channels live: %v", err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"fetchedAt": time.Now().UTC().Format(time.RFC3339),
		"channels":  channels,
	})
}

// handleAdminChannelMembers returns the members of one channel, joined with Slack user metadata
// from the existing workspace-users Redis snapshot (cache miss → empty metadata, member id only).
func (s *Server) handleAdminChannelMembers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ok, svcUnavail := s.adminReadOrInternalServiceAuthorized(r)
	if !ok {
		if svcUnavail {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		} else {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
		return
	}
	channelID := strings.TrimSpace(r.URL.Query().Get("channel_id"))
	if channelID == "" {
		writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": "missing channel_id query parameter"})
		return
	}
	if strings.TrimSpace(s.cfg.SlackBotToken) == "" {
		writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": "slack bot token is not configured (ORCHESTRATOR_SLACK_BOT_TOKEN; legacy SLACK_BOT_TOKEN still accepted)"})
		return
	}
	ids, err := FetchSlackChannelMemberIDs(r.Context(), s.cfg.SlackBotToken, channelID)
	if err != nil {
		s.log.Printf("admin channel members live (%s): %v", channelID, err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	usersByID := s.loadSlackUserIndexByID(r.Context())
	members := make([]SlackWorkspaceUser, 0, len(ids))
	for _, id := range ids {
		if u, found := usersByID[id]; found {
			members = append(members, u)
			continue
		}
		members = append(members, SlackWorkspaceUser{SlackUserID: id})
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"fetchedAt": time.Now().UTC().Format(time.RFC3339),
		"channelId": channelID,
		"members":   members,
	})
}

// loadSlackUserIndexByID returns a SlackUserID → SlackWorkspaceUser map from the Redis snapshot
// (empty map if the snapshot is missing or unparseable; member metadata then renders as id-only).
func (s *Server) loadSlackUserIndexByID(ctx context.Context) map[string]SlackWorkspaceUser {
	raw, err := s.store.GetSlackUsersSnapshotBytes(ctx)
	if err != nil {
		return map[string]SlackWorkspaceUser{}
	}
	env, err := ParseSlackUsersSnapshotEnvelope(raw)
	if err != nil {
		return map[string]SlackWorkspaceUser{}
	}
	idx := make(map[string]SlackWorkspaceUser, len(env.Users))
	for _, u := range env.Users {
		idx[u.SlackUserID] = u
	}
	return idx
}
