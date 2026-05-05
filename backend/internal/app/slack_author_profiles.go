package app

import (
	"os"
	"sort"
	"strings"
)

// SlackAuthorProfile is one row returned by `/v1/admin/slack-bot-author-profiles` (matches Next transcript UI).
type SlackAuthorProfile struct {
	SlackUserID string `json:"slackUserId"`
	EmployeeID  string `json:"employeeId"`
	DisplayName string `json:"displayName"`
	PortraitURL string `json:"portraitUrl,omitempty"`
	Email       string `json:"email,omitempty"`
}

var slackAuthorSlugDisplayNames = map[string]string{
	"alex":   "Alex",
	"tim":    "Tim",
	"ross":   "Ross",
	"garth":  "Garth",
	"joanne": "Joanne",
	"anna":   "Anna",
}

func slackDisplayNameFromWorkspaceUser(u SlackWorkspaceUser) string {
	if s := strings.TrimSpace(u.RealName); s != "" {
		return s
	}
	if s := strings.TrimSpace(u.DisplayName); s != "" {
		return s
	}
	if s := strings.TrimSpace(u.Username); s != "" {
		return s
	}
	return strings.TrimSpace(u.SlackUserID)
}

func slackAuthorProfileFromWorkspaceUser(u SlackWorkspaceUser) SlackAuthorProfile {
	id := strings.ToUpper(strings.TrimSpace(u.SlackUserID))
	dn := slackDisplayNameFromWorkspaceUser(u)
	if dn == "" {
		dn = id
	}
	email := strings.TrimSpace(strings.ToLower(u.Email))
	p := SlackAuthorProfile{
		SlackUserID: id,
		EmployeeID:  "",
		DisplayName: dn,
		PortraitURL: strings.TrimSpace(u.ProfileImageURL),
	}
	if email != "" {
		p.Email = email
	}
	return p
}

func slackAuthorSlugDisplayName(slug string) string {
	slug = strings.ToLower(strings.TrimSpace(slug))
	if slug == "" {
		return ""
	}
	if dn, ok := slackAuthorSlugDisplayNames[slug]; ok {
		return dn
	}
	return strings.ToUpper(slug[:1]) + slug[1:]
}

func looksLikeSlackUserID(id string) bool {
	id = strings.TrimSpace(id)
	if len(id) < 9 {
		return false
	}
	ch0 := id[0]
	if ch0 != 'U' && ch0 != 'u' {
		return false
	}
	for _, c := range id[1:] {
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9') {
			return false
		}
	}
	return true
}

// SlackBotAuthorProfilesFromOSEnv mirrors frontend `getSlackBotAuthorProfilesFromEnv` (MULTIAGENT_BOT_USER_IDS + *_SLACK_BOT_ID).
func SlackBotAuthorProfilesFromOSEnv() []SlackAuthorProfile {
	slugToID := map[string]string{}
	rawMulti := strings.TrimSpace(os.Getenv("MULTIAGENT_BOT_USER_IDS"))
	if rawMulti != "" {
		for _, part := range strings.Split(rawMulti, ",") {
			part = strings.TrimSpace(part)
			idx := strings.Index(part, ":")
			if idx <= 0 {
				continue
			}
			slug := strings.ToLower(strings.TrimSpace(part[:idx]))
			uid := strings.TrimSpace(part[idx+1:])
			if slug != "" && looksLikeSlackUserID(uid) {
				slugToID[slug] = uid
			}
		}
	}
	envPairs := []struct{ key, slug string }{
		{"ROSS_SLACK_BOT_ID", "ross"},
		{"TIM_SLACK_BOT_ID", "tim"},
		{"ALEX_SLACK_BOT_ID", "alex"},
		{"GARTH_SLACK_BOT_ID", "garth"},
		{"JOANNE_SLACK_BOT_ID", "joanne"},
	}
	for _, pair := range envPairs {
		v := strings.TrimSpace(os.Getenv(pair.key))
		if looksLikeSlackUserID(v) {
			slugToID[pair.slug] = v
		}
	}
	out := make([]SlackAuthorProfile, 0, len(slugToID))
	for slug, slackUserID := range slugToID {
		id := strings.ToUpper(strings.TrimSpace(slackUserID))
		out = append(out, SlackAuthorProfile{
			SlackUserID: id,
			EmployeeID:  slug,
			DisplayName: slackAuthorSlugDisplayName(slug),
			PortraitURL: "",
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SlackUserID < out[j].SlackUserID })
	return out
}

// BuildMergedSlackAuthorProfiles merges Slack `users.list` rows with env bot labels (env does not overwrite workspace).
func BuildMergedSlackAuthorProfiles(users []SlackWorkspaceUser, envBots []SlackAuthorProfile) []SlackAuthorProfile {
	by := make(map[string]SlackAuthorProfile, len(users)+len(envBots))
	for _, u := range users {
		id := strings.ToUpper(strings.TrimSpace(u.SlackUserID))
		if id == "" {
			continue
		}
		by[id] = slackAuthorProfileFromWorkspaceUser(u)
	}
	for _, e := range envBots {
		id := strings.ToUpper(strings.TrimSpace(e.SlackUserID))
		if id == "" {
			continue
		}
		if _, ok := by[id]; ok {
			continue
		}
		e2 := e
		e2.SlackUserID = id
		by[id] = e2
	}
	keys := make([]string, 0, len(by))
	for k := range by {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]SlackAuthorProfile, len(keys))
	for i, k := range keys {
		out[i] = by[k]
	}
	return out
}
