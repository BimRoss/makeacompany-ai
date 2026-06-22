package app

import (
	"context"
	"net/http"
	"sync"
	"time"
)

// landerMessagesSentDays is the sparkline window surfaced on the public
// lander. Sized to "all-time" within the per-day TTL window in
// [[store_user_messages]]; the backend trims leading zero-days so the
// chart starts at first activity, not 365 days of empty buckets.
const landerMessagesSentDays = 365

// landerMessagesSentTopUsers caps the per-user fan-out when summing the
// workspace-wide daily series. The histogram drops off steeply enough
// that 200 covers essentially the full mass; anything beyond is rounding
// error.
const landerMessagesSentTopUsers = 200

// landerMessagesSentCacheTTL bounds backend Redis fan-out under public
// lander traffic — page is force-dynamic and the client polls, so without
// this we'd run the full 30d × 200-user SCARD pipeline on every visit.
const landerMessagesSentCacheTTL = 60 * time.Second

type landerMessagesSentPoint struct {
	Day      string `json:"day"`
	Messages int64  `json:"messages"`
}

type landerMessagesSentPayload struct {
	Total int64                     `json:"total"`
	Daily []landerMessagesSentPoint `json:"daily"`
}

type landerMessagesSentCache struct {
	mu      sync.Mutex
	at      time.Time
	payload landerMessagesSentPayload
	ok      bool
}

var landerMessagesSentMemo landerMessagesSentCache

func (s *Server) computeLanderMessagesSent(ctx context.Context) (landerMessagesSentPayload, error) {
	total, err := s.store.TotalMessages(ctx)
	if err != nil {
		return landerMessagesSentPayload{}, err
	}
	bins, err := s.store.TotalMessagesDailySeries(ctx, landerMessagesSentDays, landerMessagesSentTopUsers)
	if err != nil {
		return landerMessagesSentPayload{}, err
	}
	// Trim leading zero-days so the all-time sparkline starts at first
	// activity. The TTL on per-day sets means anything older is gone, so a
	// stretch of trailing zeros at the head is just empty buckets, not a
	// dip in traffic.
	start := 0
	for start < len(bins) && bins[start].Messages == 0 {
		start++
	}
	bins = bins[start:]
	points := make([]landerMessagesSentPoint, 0, len(bins))
	for _, b := range bins {
		points = append(points, landerMessagesSentPoint{Day: b.Day, Messages: b.Messages})
	}
	return landerMessagesSentPayload{Total: total, Daily: points}, nil
}

// handleLanderMessagesSent serves the public, unauthenticated
// "real messages sent" tile on the lander: a workspace-wide deduped
// all-time count and a 30-day sparkline. Cached for landerMessagesSentCacheTTL
// to bound Redis fan-out under public traffic; the freshness loss is
// invisible at this scale.
func (s *Server) handleLanderMessagesSent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	landerMessagesSentMemo.mu.Lock()
	fresh := landerMessagesSentMemo.ok && time.Since(landerMessagesSentMemo.at) < landerMessagesSentCacheTTL
	cached := landerMessagesSentMemo.payload
	landerMessagesSentMemo.mu.Unlock()
	if fresh {
		writeJSON(w, http.StatusOK, cached)
		return
	}
	payload, err := s.computeLanderMessagesSent(r.Context())
	if err != nil {
		s.log.Printf("lander messages-sent: %v", err)
		// Fall back to last good value rather than failing the lander.
		landerMessagesSentMemo.mu.Lock()
		stale := landerMessagesSentMemo.ok
		last := landerMessagesSentMemo.payload
		landerMessagesSentMemo.mu.Unlock()
		if stale {
			writeJSON(w, http.StatusOK, last)
			return
		}
		writeJSON(w, http.StatusOK, landerMessagesSentPayload{Total: 0, Daily: []landerMessagesSentPoint{}})
		return
	}
	landerMessagesSentMemo.mu.Lock()
	landerMessagesSentMemo.payload = payload
	landerMessagesSentMemo.at = time.Now()
	landerMessagesSentMemo.ok = true
	landerMessagesSentMemo.mu.Unlock()
	writeJSON(w, http.StatusOK, payload)
}
