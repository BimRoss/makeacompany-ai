package app

import (
	"testing"
)

func TestFirstGivenNameFromSlackWorkspaceUser(t *testing.T) {
	tests := []struct {
		u    SlackWorkspaceUser
		want string
	}{
		{SlackWorkspaceUser{RealName: "Grant Foster", Email: "g@x.com"}, "Grant"},
		{SlackWorkspaceUser{DisplayName: "pat", RealName: "", Email: "p@x.com"}, "pat"},
		{SlackWorkspaceUser{RealName: "  ", DisplayName: "  Sam  ", Email: "s@x.com"}, "Sam"},
		{SlackWorkspaceUser{IsBot: true, RealName: "Bot", Email: "b@x.com"}, ""},
		{SlackWorkspaceUser{IsDeleted: true, RealName: "Gone", Email: "g@x.com"}, ""},
		{SlackWorkspaceUser{Email: "e@x.com"}, ""},
	}
	for _, tc := range tests {
		if got := firstGivenNameFromSlackWorkspaceUser(tc.u); got != tc.want {
			t.Fatalf("%+v: got %q want %q", tc.u, got, tc.want)
		}
	}
}

func TestParseSlackUsersSnapshotEnvelope(t *testing.T) {
	raw := []byte(`{"fetchedAt":"2026-04-22T12:00:00Z","snapshotNote":"test","users":[{"slackUserId":"U1","teamId":"T1","username":"ada","realName":"Ada Lovelace","displayName":"","email":"ada@example.com","isBot":false,"isDeleted":false}]}`)
	env, err := ParseSlackUsersSnapshotEnvelope(raw)
	if err != nil {
		t.Fatal(err)
	}
	if env.FetchedAt != "2026-04-22T12:00:00Z" || len(env.Users) != 1 {
		t.Fatalf("unexpected envelope: %+v", env)
	}
	if env.Users[0].SlackUserID != "U1" || env.Users[0].Email != "ada@example.com" {
		t.Fatalf("unexpected user: %+v", env.Users[0])
	}
}
