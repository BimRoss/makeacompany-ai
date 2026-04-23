package app

import "strings"

// ValidSlackChannelID returns true for Slack public/private channel ids used in the company registry (C… / G…).
func ValidSlackChannelID(id string) bool {
	id = strings.TrimSpace(id)
	if len(id) < 8 || len(id) > 24 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			continue
		}
		return false
	}
	switch id[0] {
	case 'C', 'G':
		return true
	default:
		return false
	}
}
