package app

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ipRateLimiter is a simple in-process per-IP token-bucket-like limiter with two windows.
// It's intentionally tiny: appropriate for low-volume unauth endpoints (signup, AI-backed copy gen)
// where we mostly care about stopping a single abuser, not building real DDoS protection.
type ipRateLimiter struct {
	mu          sync.Mutex
	buckets     map[string]*ipBucket
	perMinute   int
	perHour     int
	lastCleanup time.Time
}

type ipBucket struct {
	minuteCount   int
	minuteResetAt time.Time
	hourCount     int
	hourResetAt   time.Time
}

func newIPRateLimiter(perMinute, perHour int) *ipRateLimiter {
	return &ipRateLimiter{
		buckets:   make(map[string]*ipBucket),
		perMinute: perMinute,
		perHour:   perHour,
	}
}

// allow returns (ok, retryAfter). When ok is false, retryAfter is the seconds-until-reset.
func (l *ipRateLimiter) allow(ip string) (bool, int) {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	b, ok := l.buckets[ip]
	if !ok {
		b = &ipBucket{
			minuteResetAt: now.Add(time.Minute),
			hourResetAt:   now.Add(time.Hour),
		}
		l.buckets[ip] = b
	}
	if !now.Before(b.minuteResetAt) {
		b.minuteCount = 0
		b.minuteResetAt = now.Add(time.Minute)
	}
	if !now.Before(b.hourResetAt) {
		b.hourCount = 0
		b.hourResetAt = now.Add(time.Hour)
	}
	if b.minuteCount >= l.perMinute {
		return false, int(time.Until(b.minuteResetAt).Seconds()) + 1
	}
	if b.hourCount >= l.perHour {
		return false, int(time.Until(b.hourResetAt).Seconds()) + 1
	}
	b.minuteCount++
	b.hourCount++

	if now.Sub(l.lastCleanup) > 5*time.Minute {
		for k, v := range l.buckets {
			if !now.Before(v.hourResetAt) {
				delete(l.buckets, k)
			}
		}
		l.lastCleanup = now
	}
	return true, 0
}

// clientIP extracts the best-effort client IP from a request, honoring X-Forwarded-For
// (first hop) and X-Real-IP, falling back to RemoteAddr.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if comma := strings.Index(xff, ","); comma >= 0 {
			return strings.TrimSpace(xff[:comma])
		}
		return strings.TrimSpace(xff)
	}
	if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
		return xri
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
