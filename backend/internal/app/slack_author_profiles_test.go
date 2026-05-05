package app

import (
	"testing"
)

func TestBuildMergedSlackAuthorProfiles_workspaceWinsEnvGapFills(t *testing.T) {
	users := []SlackWorkspaceUser{
		{SlackUserID: "U0ATE4W749", RealName: "Grant Foster", Username: "grant", Email: "g@example.com", ProfileImageURL: "https://ex/img.png"},
	}
	env := []SlackAuthorProfile{
		{SlackUserID: "U0ATE4W749", EmployeeID: "ross", DisplayName: "Wrong"},
		{SlackUserID: "UALTONLYENV", EmployeeID: "ross", DisplayName: "Ross"},
	}
	got := BuildMergedSlackAuthorProfiles(users, env)
	if len(got) != 2 {
		t.Fatalf("len=%d", len(got))
	}
	var human, onlyenv SlackAuthorProfile
	for _, p := range got {
		switch p.SlackUserID {
		case "U0ATE4W749":
			human = p
		case "UALTONLYENV":
			onlyenv = p
		}
	}
	if human.DisplayName != "Grant Foster" || human.Email != "g@example.com" {
		t.Fatalf("human: %#v", human)
	}
	if onlyenv.DisplayName != "Ross" || onlyenv.EmployeeID != "ross" {
		t.Fatalf("env: %#v", onlyenv)
	}
}

func TestSlackBotAuthorProfilesFromOSEnv_parsesMulti(t *testing.T) {
	t.Setenv("MULTIAGENT_BOT_USER_IDS", "ross:UABCDEF12HH,garth:UZYXWVU09X")
	t.Setenv("ROSS_SLACK_BOT_ID", "") // unset override; MULTIAGENT wins for ross
	got := SlackBotAuthorProfilesFromOSEnv()
	by := map[string]SlackAuthorProfile{}
	for _, p := range got {
		by[p.SlackUserID] = p
	}
	if g, ok := by["UABCDEF12HH"]; !ok || g.EmployeeID != "ross" || g.DisplayName != "Ross" {
		t.Fatalf("ross multi: %#v ok=%v", g, ok)
	}
	if g, ok := by["UZYXWVU09X"]; !ok || g.DisplayName != "Garth" {
		t.Fatalf("garth: %#v", g)
	}
}

func TestSlackBotAuthorProfilesFromOSEnv_individualOverridesMulti(t *testing.T) {
	t.Setenv("MULTIAGENT_BOT_USER_IDS", "ross:UABCDEF12HH,garth:UZYXWVU09X")
	t.Setenv("ROSS_SLACK_BOT_ID", "UALTROVERRID")
	got := SlackBotAuthorProfilesFromOSEnv()
	var rossSeen bool
	for _, p := range got {
		if p.EmployeeID == "ross" {
			if p.SlackUserID != "UALTROVERRID" {
				t.Fatalf("ross should use override ID, got %+v", p)
			}
			rossSeen = true
		}
	}
	if !rossSeen {
		t.Fatal("missing ross")
	}
}
