package app

import "testing"

func TestValidSlackChannelID(t *testing.T) {
	if !ValidSlackChannelID("C01234567") {
		t.Fatal("expected valid public channel id")
	}
	if !ValidSlackChannelID("G01234567") {
		t.Fatal("expected valid private channel id")
	}
	if ValidSlackChannelID("D01234567") {
		t.Fatal("dm id should be invalid")
	}
	if ValidSlackChannelID("C012") {
		t.Fatal("too short")
	}
	if ValidSlackChannelID("C012345") {
		t.Fatal("too short (7 chars)")
	}
}
