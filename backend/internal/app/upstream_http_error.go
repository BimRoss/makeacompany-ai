package app

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// UpstreamHTTPError captures non-2xx responses from upstream APIs.
type UpstreamHTTPError struct {
	Source      string
	StatusCode  int
	RetryAfter  string
	BodySnippet string
}

func (e *UpstreamHTTPError) Error() string {
	if e == nil {
		return "upstream http error"
	}
	msg := strings.TrimSpace(e.BodySnippet)
	if msg == "" {
		msg = "no body"
	}
	if ra := strings.TrimSpace(e.RetryAfter); ra != "" {
		return fmt.Sprintf("%s: HTTP %d (Retry-After=%s): %s", strings.TrimSpace(e.Source), e.StatusCode, ra, msg)
	}
	return fmt.Sprintf("%s: HTTP %d: %s", strings.TrimSpace(e.Source), e.StatusCode, msg)
}

func parseRetryAfterSeconds(raw string) (int, bool) {
	v := strings.TrimSpace(raw)
	if v == "" {
		return 0, false
	}
	if secs, err := strconv.Atoi(v); err == nil && secs >= 0 {
		return secs, true
	}
	if when, err := httpDate(v); err == nil {
		delta := int(time.Until(when).Seconds())
		if delta < 0 {
			return 0, true
		}
		return delta, true
	}
	return 0, false
}

func httpDate(v string) (time.Time, error) {
	if t, err := time.Parse(time.RFC1123, v); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC1123Z, v)
}
