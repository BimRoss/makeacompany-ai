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

// SlackWorkspaceUser is one workspace member from Slack users.list (admin snapshot / live query).
type SlackWorkspaceUser struct {
	SlackUserID string `json:"slackUserId"`
	TeamID      string `json:"teamId"`
	Username    string `json:"username"`
	RealName    string `json:"realName"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	// ProfileImageURL is from Slack profile image_* (HTTPS URL; refreshed when snapshot is refreshed).
	ProfileImageURL string `json:"profileImageUrl,omitempty"`
	IsBot           bool   `json:"isBot"`
	IsDeleted       bool   `json:"isDeleted"`
	// Terms is merged from makeacompany:user_profile (Joanne #humans terms flow); not from Slack API.
	Terms string `json:"terms,omitempty"`
	// TermsMessageTs is the Slack message_ts of the terms prompt when accepted.
	TermsMessageTs string `json:"termsMessageTs,omitempty"`
}

type slackUsersListResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
	// Members matches Slack Web API users.list payload.
	Members []struct {
		ID      string `json:"id"`
		TeamID  string `json:"team_id"`
		Name    string `json:"name"`
		Deleted bool   `json:"deleted"`
		IsBot   bool   `json:"is_bot"`
		Profile struct {
			Email       string `json:"email"`
			RealName    string `json:"real_name"`
			DisplayName string `json:"display_name"`
			Image72     string `json:"image_72"`
			Image48     string `json:"image_48"`
			Image32     string `json:"image_32"`
		} `json:"profile"`
	} `json:"members"`
	ResponseMetadata struct {
		NextCursor string `json:"next_cursor"`
	} `json:"response_metadata"`
}

type slackUsersSnapshotEnvelope struct {
	FetchedAt    string               `json:"fetchedAt"`
	SnapshotNote string               `json:"snapshotNote"`
	Users        []SlackWorkspaceUser `json:"users"`
}

const (
	slackUsersListURL        = "https://slack.com/api/users.list"
	slackUsersListPageLimit  = 200
	slackUsersListMaxPages   = 40
	slackUsersListPagePause  = 400 * time.Millisecond
	slackUsersListHTTPClient = 90 * time.Second
)

// FetchSlackWorkspaceUsers calls Slack users.list with cursoring; paces requests for tier-2 limits.
func FetchSlackWorkspaceUsers(ctx context.Context, botToken string) ([]SlackWorkspaceUser, error) {
	botToken = strings.TrimSpace(botToken)
	if botToken == "" {
		return nil, errors.New("missing slack bot token")
	}
	client := &http.Client{Timeout: slackUsersListHTTPClient}
	var out []SlackWorkspaceUser
	cursor := ""
	for page := 0; page < slackUsersListMaxPages; page++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		form := url.Values{}
		form.Set("limit", fmt.Sprintf("%d", slackUsersListPageLimit))
		if cursor != "" {
			form.Set("cursor", cursor)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, slackUsersListURL, strings.NewReader(form.Encode()))
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
			return nil, &UpstreamHTTPError{
				Source:      "slack users.list",
				StatusCode:  resp.StatusCode,
				RetryAfter:  strings.TrimSpace(resp.Header.Get("Retry-After")),
				BodySnippet: strings.TrimSpace(string(snippetBytes(body, 300))),
			}
		}
		var parsed slackUsersListResponse
		if err := json.Unmarshal(body, &parsed); err != nil {
			return nil, fmt.Errorf("slack users.list json: %w", err)
		}
		if !parsed.OK {
			if parsed.Error != "" {
				return nil, fmt.Errorf("slack users.list: %s", parsed.Error)
			}
			return nil, errors.New("slack users.list: not ok")
		}
		for _, m := range parsed.Members {
			email := strings.TrimSpace(m.Profile.Email)
			real := strings.TrimSpace(m.Profile.RealName)
			disp := strings.TrimSpace(m.Profile.DisplayName)
			if real == "" && disp != "" {
				real = disp
			}
			img := strings.TrimSpace(m.Profile.Image72)
			if img == "" {
				img = strings.TrimSpace(m.Profile.Image48)
			}
			if img == "" {
				img = strings.TrimSpace(m.Profile.Image32)
			}
			out = append(out, SlackWorkspaceUser{
				SlackUserID:     strings.TrimSpace(m.ID),
				TeamID:          strings.TrimSpace(m.TeamID),
				Username:        strings.TrimSpace(m.Name),
				RealName:        real,
				DisplayName:     disp,
				Email:           strings.ToLower(email),
				ProfileImageURL: img,
				IsBot:           m.IsBot,
				IsDeleted:       m.Deleted,
			})
		}
		cursor = strings.TrimSpace(parsed.ResponseMetadata.NextCursor)
		if cursor == "" {
			break
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(slackUsersListPagePause):
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a := sortKeySlackUser(out[i])
		b := sortKeySlackUser(out[j])
		if a != b {
			return a < b
		}
		return out[i].SlackUserID < out[j].SlackUserID
	})
	return out, nil
}

// firstGivenNameFromSlackWorkspaceUser returns the first word of real name or display name for greetings, or "".
func firstGivenNameFromSlackWorkspaceUser(u SlackWorkspaceUser) string {
	if u.IsBot || u.IsDeleted {
		return ""
	}
	name := strings.TrimSpace(u.RealName)
	if name == "" {
		name = strings.TrimSpace(u.DisplayName)
	}
	if name == "" {
		return ""
	}
	parts := strings.Fields(name)
	if len(parts) == 0 {
		return ""
	}
	return parts[0]
}

func sortKeySlackUser(u SlackWorkspaceUser) string {
	if s := strings.TrimSpace(u.RealName); s != "" {
		return strings.ToLower(s)
	}
	if s := strings.TrimSpace(u.DisplayName); s != "" {
		return strings.ToLower(s)
	}
	if s := strings.TrimSpace(u.Username); s != "" {
		return strings.ToLower(s)
	}
	return strings.ToLower(u.SlackUserID)
}

func snippetBytes(b []byte, max int) []byte {
	if len(b) <= max {
		return b
	}
	return b[:max]
}

// MarshalSlackUsersSnapshot builds JSON for Redis (PII: emails when Slack exposes them).
func MarshalSlackUsersSnapshot(users []SlackWorkspaceUser) ([]byte, error) {
	env := slackUsersSnapshotEnvelope{
		FetchedAt:    time.Now().UTC().Format(time.RFC3339),
		SnapshotNote: "Refreshed from Slack users.list (workspace members; email when visible to the listing token).",
		Users:        users,
	}
	return json.Marshal(env)
}

// ParseSlackUsersSnapshotEnvelope unmarshals Redis JSON.
func ParseSlackUsersSnapshotEnvelope(raw []byte) (slackUsersSnapshotEnvelope, error) {
	var env slackUsersSnapshotEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return slackUsersSnapshotEnvelope{}, err
	}
	return env, nil
}
