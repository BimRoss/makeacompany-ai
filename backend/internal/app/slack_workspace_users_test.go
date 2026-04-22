package app

import "testing"

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
