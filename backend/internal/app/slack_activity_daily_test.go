package app

import "testing"

func TestIsCountableSlackMessage(t *testing.T) {
	cases := []struct {
		name             string
		msgType, subtype string
		user, botID      string
		want             bool
	}{
		{"plain human message", "message", "", "U123", "", true},
		{"thread_broadcast counts", "message", "thread_broadcast", "U123", "", true},
		{"bot post excluded", "message", "bot_message", "USLACKBOT", "B123", false},
		{"bot_id set even without subtype", "message", "", "U123", "B999", false},
		{"channel_join noise", "message", "channel_join", "U123", "", false},
		{"empty user (tombstone)", "message", "", "", "", false},
		{"non-message event", "user_typing", "", "U123", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := isCountableSlackMessage(tc.msgType, tc.subtype, tc.user, tc.botID)
			if got != tc.want {
				t.Fatalf("isCountableSlackMessage(%q,%q,%q,%q) = %v want %v",
					tc.msgType, tc.subtype, tc.user, tc.botID, got, tc.want)
			}
		})
	}
}

func TestMarshalRoundTripSlackActivityDay(t *testing.T) {
	in := SlackActivityDay{
		Day:             "2026-06-10",
		FetchedAt:       "2026-06-11T00:30:00Z",
		ChannelsScanned: 2,
		MessagesTotal:   5,
		UniqueUsers:     2,
		ByUser:          map[string]int{"U1": 3, "U2": 2},
		Channels: []SlackChannelDayCounts{
			{ChannelID: "C1", ChannelName: "welcome", Messages: 3, ByUser: map[string]int{"U1": 3}},
			{ChannelID: "C2", IsPrivate: true, Messages: 2, ByUser: map[string]int{"U2": 2}},
		},
	}
	blob, err := MarshalSlackActivityDay(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got, err := ParseSlackActivityDay(blob)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.Day != in.Day || got.MessagesTotal != in.MessagesTotal || got.UniqueUsers != in.UniqueUsers {
		t.Fatalf("round trip mismatch: %+v", got)
	}
	if got.ByUser["U1"] != 3 || got.ByUser["U2"] != 2 {
		t.Fatalf("byUser mismatch: %+v", got.ByUser)
	}
	if len(got.Channels) != 2 || got.Channels[1].IsPrivate != true {
		t.Fatalf("channels mismatch: %+v", got.Channels)
	}
}
