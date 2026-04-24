package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

const keyPrefix = "makeacompany"

// WaitlistCap is the maximum number of distinct paid waitlist signups we accept.
const WaitlistCap int64 = 100

const (
	statsSignupsKey     = keyPrefix + ":stats:signups"
	statsAmountCentsKey = keyPrefix + ":stats:amount_cents"
)
const adminSessionKeyPrefix = keyPrefix + ":admin_session:"

// maxWaitlistList caps SCAN/HGETALL work for admin listing (pathological keyspace guard).
const maxWaitlistList = 500

// maxCompanyChannelsList caps HGETALL company channel registry rows returned to admin UI.
const maxCompanyChannelsList = 200

// companyChannelsInvalidatePubSubChannel must match employee-factory/internal/channelregistry.CompanyChannelsInvalidateChannel.
const companyChannelsInvalidatePubSubChannel = "employee-factory:company_channels:invalidate"

const waitlistKeyMatch = keyPrefix + ":waitlist:*"

// ErrWaitlistFull is returned when the waitlist has reached WaitlistCap.
var ErrWaitlistFull = errors.New("waitlist full")

// KEYS: session key, stats signups, stats amount cents, user hash key
// ARGV: cap, email, stripeCustomer, paymentStatus, sessionID, currency, amountTotal (decimal string), updatedAt (RFC3339)
const saveWaitlistLua = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  return 2
end
local cap = tonumber(ARGV[1])
local n = tonumber(redis.call("GET", KEYS[2])) or 0
if n >= cap then
  return 0
end
redis.call("SET", KEYS[1], ARGV[2])
redis.call("INCR", KEYS[2])
local amt = tonumber(ARGV[7])
if amt and amt > 0 then
  redis.call("INCRBY", KEYS[3], amt)
end
redis.call("HSET", KEYS[4],
  "email", ARGV[2],
  "stripeSessionId", ARGV[5],
  "stripeCustomer", ARGV[3],
  "paymentStatus", ARGV[4],
  "amountTotal", ARGV[7],
  "currency", ARGV[6],
  "updatedAt", ARGV[8],
  "source", "waitlist")
return 1
`

type Store struct {
	rdb                    *redis.Client
	companyChannelsRdb     *redis.Client // optional second Redis for shared employee-factory registry; nil = use rdb
	orchestratorCatalogURL string        // SLACK_ORCHESTRATOR_CAPABILITY_CATALOG_URL — seed empty Redis + merge baseline

	baselineMu     sync.Mutex
	baselineMerge  CapabilityCatalog
	baselineExpiry time.Time
}

const orchestratorCatalogBaselineTTL = 2 * time.Minute

// NewStore opens the primary Redis client. If companyChannelsRedisURL is non-empty and differs from redisURL,
// a second client is used only for ListCompanyChannels (same pattern as employee-factory vs makeacompany-ai split).
func NewStore(redisURL, companyChannelsRedisURL, orchestratorCatalogURL string) (*Store, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	primary := redis.NewClient(opts)
	orchURL := strings.TrimSpace(orchestratorCatalogURL)
	st := &Store{rdb: primary, orchestratorCatalogURL: orchURL}
	ccURL := strings.TrimSpace(companyChannelsRedisURL)
	if ccURL == "" || ccURL == strings.TrimSpace(redisURL) {
		return st, nil
	}
	ccOpts, err := redis.ParseURL(ccURL)
	if err != nil {
		_ = primary.Close()
		return nil, fmt.Errorf("parse company channels redis url: %w", err)
	}
	st.companyChannelsRdb = redis.NewClient(ccOpts)
	return st, nil
}

// orchestratorMergeBaseline returns a cached catalog from slack-orchestrator for
// mergeCapabilityCatalogWithDefaults. Empty if URL unset. On fetch error, returns the last
// successful baseline when available.
func (s *Store) orchestratorMergeBaseline(ctx context.Context) CapabilityCatalog {
	if s == nil {
		return CapabilityCatalog{}
	}
	url := strings.TrimSpace(s.orchestratorCatalogURL)
	if url == "" {
		return CapabilityCatalog{}
	}
	s.baselineMu.Lock()
	defer s.baselineMu.Unlock()
	if len(s.baselineMerge.Skills) > 0 && time.Now().Before(s.baselineExpiry) {
		return s.baselineMerge
	}
	cat, err := FetchCapabilityCatalogFromOrchestrator(ctx, url)
	if err != nil {
		if len(s.baselineMerge.Skills) > 0 {
			return s.baselineMerge
		}
		return CapabilityCatalog{}
	}
	s.baselineMerge = cat
	s.baselineExpiry = time.Now().Add(orchestratorCatalogBaselineTTL)
	return cat
}

func (s *Store) Close() error {
	if s == nil {
		return nil
	}
	if s.companyChannelsRdb != nil {
		_ = s.companyChannelsRdb.Close()
	}
	return s.rdb.Close()
}

func (s *Store) companyChannelsRedis() *redis.Client {
	if s == nil {
		return nil
	}
	if s.companyChannelsRdb != nil {
		return s.companyChannelsRdb
	}
	return s.rdb
}

func (s *Store) Ping(ctx context.Context) error {
	return s.rdb.Ping(ctx).Err()
}

// SaveWaitlistSignup stores waitlist purchaser info; idempotent per checkout session id.
// If the waitlist is at capacity and this session has not been stored before, returns ErrWaitlistFull.
func (s *Store) SaveWaitlistSignup(ctx context.Context, sessionID, email, stripeCustomer, paymentStatus string, amountTotal int64, currency string, stripeProductID string) error {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" {
		return fmt.Errorf("missing email")
	}
	if sessionID == "" {
		return fmt.Errorf("missing session id")
	}

	sessKey := fmt.Sprintf("%s:checkout:%s", keyPrefix, sessionID)
	userKey := fmt.Sprintf("%s:waitlist:%s", keyPrefix, email)
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := s.rdb.Eval(ctx, saveWaitlistLua,
		[]string{sessKey, statsSignupsKey, statsAmountCentsKey, userKey},
		strconv.FormatInt(WaitlistCap, 10),
		email,
		stripeCustomer,
		paymentStatus,
		sessionID,
		currency,
		strconv.FormatInt(amountTotal, 10),
		now,
	).Int64()
	if err != nil {
		return err
	}
	switch res {
	case 0:
		return ErrWaitlistFull
	case 1, 2:
		if err := s.UpsertUserProfileAfterWaitlist(ctx, email, stripeCustomer, sessionID, paymentStatus, stripeProductID); err != nil {
			return fmt.Errorf("user profile merge: %w", err)
		}
		return nil
	default:
		return fmt.Errorf("waitlist save: unexpected script status %d", res)
	}
}

// GetWaitlistStats returns aggregate counters maintained on successful first-time session processing.
func (s *Store) GetWaitlistStats(ctx context.Context) (signups int64, amountCents int64, err error) {
	n, err := s.rdb.Get(ctx, statsSignupsKey).Int64()
	if err == redis.Nil {
		n = 0
	} else if err != nil {
		return 0, 0, err
	}
	a, err := s.rdb.Get(ctx, statsAmountCentsKey).Int64()
	if err == redis.Nil {
		a = 0
	} else if err != nil {
		return 0, 0, err
	}
	return n, a, nil
}

// GetWaitlistStatsForPublic returns signups as the greater of (a) Redis counters updated on each
// successful checkout save and (b) deduped purchaser rows in the Stripe snapshot blob (same list as
// admin). Using max() avoids a stale snapshot hiding a payment that just landed: checkout-status and
// webhooks update Redis immediately but only cron/admin refresh rewrite the snapshot JSON.
func (s *Store) GetWaitlistStatsForPublic(ctx context.Context) (signups int64, amountCents int64, err error) {
	signups, amountCents, err = s.GetWaitlistStats(ctx)
	if err != nil {
		return 0, 0, err
	}
	raw, snapErr := s.GetStripeWaitlistSnapshotBytes(ctx)
	if snapErr != nil {
		if errors.Is(snapErr, ErrStripeWaitlistSnapshotMissing) {
			return signups, amountCents, nil
		}
		return signups, amountCents, nil
	}
	env, parseErr := ParseStripeWaitlistSnapshotEnvelope(raw)
	if parseErr != nil {
		return signups, amountCents, nil
	}
	stripeN := int64(len(env.Purchasers))
	if stripeN > signups {
		signups = stripeN
	}
	return signups, amountCents, nil
}

// WaitlistUser is one row from Redis hash makeacompany:waitlist:<email>.
type WaitlistUser struct {
	Email           string `json:"email"`
	StripeSessionID string `json:"stripeSessionId"`
	StripeCustomer  string `json:"stripeCustomer"`
	PaymentStatus   string `json:"paymentStatus"`
	AmountTotal     string `json:"amountTotal"`
	Currency        string `json:"currency"`
	UpdatedAt       string `json:"updatedAt"`
	Source          string `json:"source"`
}

type AdminSession struct {
	Token     string `json:"token"`
	Email     string `json:"email"`
	CreatedAt string `json:"createdAt"`
	ExpiresAt string `json:"expiresAt"`
}

// ListWaitlistUsers returns waitlist signup hashes via SCAN (not KEYS), newest updatedAt first.
// At most maxWaitlistList rows are returned.
func (s *Store) ListWaitlistUsers(ctx context.Context) ([]WaitlistUser, error) {
	var users []WaitlistUser
	var cursor uint64
outer:
	for {
		keys, next, err := s.rdb.Scan(ctx, cursor, waitlistKeyMatch, 64).Result()
		if err != nil {
			return nil, err
		}
		for _, key := range keys {
			if len(users) >= maxWaitlistList {
				break outer
			}
			vals, err := s.rdb.HGetAll(ctx, key).Result()
			if err != nil {
				return nil, err
			}
			if len(vals) == 0 {
				continue
			}
			users = append(users, WaitlistUser{
				Email:           vals["email"],
				StripeSessionID: vals["stripeSessionId"],
				StripeCustomer:  vals["stripeCustomer"],
				PaymentStatus:   vals["paymentStatus"],
				AmountTotal:     vals["amountTotal"],
				Currency:        vals["currency"],
				UpdatedAt:       vals["updatedAt"],
				Source:          vals["source"],
			})
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	sort.Slice(users, func(i, j int) bool {
		ti, _ := time.Parse(time.RFC3339, users[i].UpdatedAt)
		tj, _ := time.Parse(time.RFC3339, users[j].UpdatedAt)
		if ti.IsZero() && tj.IsZero() {
			return users[i].Email < users[j].Email
		}
		if ti.IsZero() {
			return false
		}
		if tj.IsZero() {
			return true
		}
		return ti.After(tj)
	})
	return users, nil
}

func adminSessionKey(token string) string {
	return adminSessionKeyPrefix + strings.TrimSpace(token)
}

func (s *Store) CreateAdminSession(ctx context.Context, token, email string, expiresAt time.Time) error {
	token = strings.TrimSpace(token)
	email = strings.ToLower(strings.TrimSpace(email))
	if token == "" || email == "" {
		return fmt.Errorf("missing admin session token/email")
	}
	if expiresAt.IsZero() {
		return fmt.Errorf("missing admin session expiration")
	}
	ttl := time.Until(expiresAt)
	if ttl <= 0 {
		return fmt.Errorf("admin session already expired")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	key := adminSessionKey(token)
	pipe := s.rdb.TxPipeline()
	pipe.HSet(ctx, key, map[string]any{
		"email":     email,
		"createdAt": now,
		"expiresAt": expiresAt.UTC().Format(time.RFC3339),
	})
	pipe.Expire(ctx, key, ttl)
	_, err := pipe.Exec(ctx)
	if err != nil {
		_ = s.rdb.Del(ctx, key).Err()
		return err
	}
	return nil
}

func (s *Store) GetAdminSession(ctx context.Context, token string) (AdminSession, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return AdminSession{}, fmt.Errorf("missing admin session token")
	}
	key := adminSessionKey(token)
	vals, err := s.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return AdminSession{}, err
	}
	if len(vals) == 0 {
		return AdminSession{}, redis.Nil
	}
	out := AdminSession{
		Token:     token,
		Email:     strings.ToLower(strings.TrimSpace(vals["email"])),
		CreatedAt: strings.TrimSpace(vals["createdAt"]),
		ExpiresAt: strings.TrimSpace(vals["expiresAt"]),
	}
	if out.Email == "" {
		return AdminSession{}, redis.Nil
	}
	gone, err := s.repairAdminSessionTTLIfNeeded(ctx, key, out.ExpiresAt)
	if err != nil {
		return AdminSession{}, err
	}
	if gone {
		return AdminSession{}, redis.Nil
	}
	return out, nil
}

// repairAdminSessionTTLIfNeeded sets Redis TTL when the hash exists but has no EXPIRE (legacy or failed Expire).
// If expiresAt is missing, invalid, or in the past, the key is deleted and gone is true.
// go-redis TTL uses time.Duration(-1) and time.Duration(-2) for Redis -1 / -2 (see DurationCmd.readReply).
func (s *Store) repairAdminSessionTTLIfNeeded(ctx context.Context, key, expiresAtRFC3339 string) (gone bool, err error) {
	ttl, err := s.rdb.TTL(ctx, key).Result()
	if err != nil {
		return false, err
	}
	if ttl != time.Duration(-1) {
		return false, nil
	}
	expiresAtRFC3339 = strings.TrimSpace(expiresAtRFC3339)
	if expiresAtRFC3339 == "" {
		if err := s.rdb.Del(ctx, key).Err(); err != nil {
			return false, err
		}
		return true, nil
	}
	expiresAt, err := time.Parse(time.RFC3339, expiresAtRFC3339)
	if err != nil {
		if err := s.rdb.Del(ctx, key).Err(); err != nil {
			return false, err
		}
		return true, nil
	}
	remaining := time.Until(expiresAt.UTC())
	if remaining <= 0 {
		if err := s.rdb.Del(ctx, key).Err(); err != nil {
			return false, err
		}
		return true, nil
	}
	if err := s.rdb.Expire(ctx, key, remaining).Err(); err != nil {
		return false, err
	}
	return false, nil
}

func (s *Store) DeleteAdminSession(ctx context.Context, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}
	return s.rdb.Del(ctx, adminSessionKey(token)).Err()
}

// CompanyChannel mirrors employee-factory/config.CompanyChannelRuntime JSON for Redis HASH values.
type CompanyChannel struct {
	CompanySlug                string   `json:"company_slug"`
	ChannelID                  string   `json:"channel_id"`
	DisplayName                string   `json:"display_name,omitempty"`
	OwnerIDs                   []string `json:"owner_ids,omitempty"`
	PrimaryOwner               string   `json:"primary_owner,omitempty"`        // legacy: merged on read
	AllowedOperatorIDs         []string `json:"allowed_operator_ids,omitempty"` // legacy
	ThreadsEnabled             bool     `json:"threads_enabled"`
	GeneralAutoReactionEnabled bool     `json:"general_auto_reaction_enabled"`
	GeneralResponsesMuted      bool     `json:"general_responses_muted,omitempty"`
	OutOfOfficeEnabled         bool     `json:"out_of_office_enabled"`
}

func effectiveCompanyChannelOwners(e CompanyChannel) []string {
	var out []string
	seen := map[string]bool{}
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			return
		}
		seen[s] = true
		out = append(out, s)
	}
	for _, id := range e.OwnerIDs {
		add(id)
	}
	if len(out) > 0 {
		return out
	}
	for _, id := range e.AllowedOperatorIDs {
		add(id)
	}
	if len(out) > 0 {
		return out
	}
	if po := strings.TrimSpace(e.PrimaryOwner); po != "" {
		return []string{po}
	}
	return nil
}

func normalizeCompanyChannel(e CompanyChannel, hashField string) CompanyChannel {
	e.ChannelID = strings.TrimSpace(e.ChannelID)
	e.CompanySlug = strings.TrimSpace(e.CompanySlug)
	e.DisplayName = strings.TrimSpace(e.DisplayName)
	e.OwnerIDs = effectiveCompanyChannelOwners(e)
	e.PrimaryOwner = ""
	e.AllowedOperatorIDs = nil
	if e.ChannelID == "" {
		e.ChannelID = strings.TrimSpace(hashField)
	}
	e.ThreadsEnabled = true
	return e
}

// ListCompanyChannels reads the shared Redis HASH used by employee-factory (field = channel id, value = JSON).
// Results are sorted by company_slug then channel_id. If more than maxCompanyChannelsList entries exist, truncated is true.
func (s *Store) ListCompanyChannels(ctx context.Context, hashKey string) ([]CompanyChannel, bool, error) {
	rdb := s.companyChannelsRedis()
	if s == nil || rdb == nil {
		return nil, false, fmt.Errorf("company channels: nil store")
	}
	k := strings.TrimSpace(hashKey)
	if k == "" {
		k = "employee-factory:company_channels"
	}
	raw, err := rdb.HGetAll(ctx, k).Result()
	if err != nil {
		return nil, false, err
	}
	if len(raw) == 0 {
		return []CompanyChannel{}, false, nil
	}
	out := make([]CompanyChannel, 0, len(raw))
	for field, val := range raw {
		val = strings.TrimSpace(val)
		if val == "" {
			continue
		}
		var e CompanyChannel
		if err := json.Unmarshal([]byte(val), &e); err != nil {
			continue
		}
		e = normalizeCompanyChannel(e, field)
		if e.ChannelID == "" {
			continue
		}
		if e.ChannelID != strings.TrimSpace(field) {
			continue
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CompanySlug != out[j].CompanySlug {
			return out[i].CompanySlug < out[j].CompanySlug
		}
		return out[i].ChannelID < out[j].ChannelID
	})
	truncated := len(out) > maxCompanyChannelsList
	if truncated {
		out = out[:maxCompanyChannelsList]
	}
	return out, truncated, nil
}

// ErrCompanyChannelNotFound is returned when the Redis registry has no JSON for this channel id.
var ErrCompanyChannelNotFound = errors.New("company channel not found")

func companyChannelsHashKey(hashKey string) string {
	k := strings.TrimSpace(hashKey)
	if k == "" {
		return "employee-factory:company_channels"
	}
	return k
}

// GetCompanyChannel returns one registry entry by Slack channel id (hash field).
func (s *Store) GetCompanyChannel(ctx context.Context, hashKey, channelID string) (CompanyChannel, error) {
	rdb := s.companyChannelsRedis()
	if s == nil || rdb == nil {
		return CompanyChannel{}, fmt.Errorf("company channels: nil store")
	}
	cid := strings.TrimSpace(channelID)
	if cid == "" {
		return CompanyChannel{}, fmt.Errorf("company channels: empty channel id")
	}
	k := companyChannelsHashKey(hashKey)
	raw, err := rdb.HGet(ctx, k, cid).Result()
	if err == redis.Nil {
		return CompanyChannel{}, ErrCompanyChannelNotFound
	}
	if err != nil {
		return CompanyChannel{}, err
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return CompanyChannel{}, ErrCompanyChannelNotFound
	}
	var e CompanyChannel
	if err := json.Unmarshal([]byte(raw), &e); err != nil {
		return CompanyChannel{}, fmt.Errorf("company channels: decode %s: %w", cid, err)
	}
	e = normalizeCompanyChannel(e, cid)
	if e.ChannelID == "" || e.ChannelID != cid {
		return CompanyChannel{}, fmt.Errorf("company channels: bad record for %s", cid)
	}
	return e, nil
}

// CompanyChannelPatch is a partial update applied on top of the existing Redis JSON.
type CompanyChannelPatch struct {
	GeneralAutoReactionEnabled *bool `json:"general_auto_reaction_enabled,omitempty"`
	GeneralResponsesMuted      *bool `json:"general_responses_muted,omitempty"`
	OutOfOfficeEnabled         *bool `json:"out_of_office_enabled,omitempty"`
}

// PatchCompanyChannel merges patch into the stored record and writes it back to the hash.
func (s *Store) PatchCompanyChannel(ctx context.Context, hashKey, channelID string, patch CompanyChannelPatch) (CompanyChannel, error) {
	e, err := s.GetCompanyChannel(ctx, hashKey, channelID)
	if err != nil {
		return CompanyChannel{}, err
	}
	if patch.GeneralAutoReactionEnabled != nil {
		e.GeneralAutoReactionEnabled = *patch.GeneralAutoReactionEnabled
	}
	if patch.GeneralResponsesMuted != nil {
		e.GeneralResponsesMuted = *patch.GeneralResponsesMuted
	}
	if patch.OutOfOfficeEnabled != nil {
		e.OutOfOfficeEnabled = *patch.OutOfOfficeEnabled
	}
	e = normalizeCompanyChannel(e, e.ChannelID)
	b, err := json.Marshal(e)
	if err != nil {
		return CompanyChannel{}, err
	}
	rdb := s.companyChannelsRedis()
	if s == nil || rdb == nil {
		return CompanyChannel{}, fmt.Errorf("company channels: nil store")
	}
	k := companyChannelsHashKey(hashKey)
	if err := rdb.HSet(ctx, k, e.ChannelID, string(b)).Err(); err != nil {
		return CompanyChannel{}, err
	}
	if pubErr := rdb.Publish(ctx, companyChannelsInvalidatePubSubChannel, e.ChannelID).Err(); pubErr != nil {
		log.Printf("company channels: invalidate publish: %v", pubErr)
	}
	return e, nil
}

// maxDiscoverChannels caps one-shot Slack → Redis placeholder upserts from the admin UI.
const maxDiscoverChannels = 200

// DiscoveredChannelInput is a Slack channel from users.conversations plus optional human member ids from conversations.members.
type DiscoveredChannelInput struct {
	ChannelID string
	Name      string
	OwnerIDs  []string
}

const maxOwnerIDsPerChannel = 100

// UpsertDiscoveredCompanyChannels merges Slack-derived defaults into Redis: optional owner_ids from Slack,
// display name, company slug. Preserves out_of_office, general_responses_muted, and general_auto_reaction_enabled
// when a JSON row already exists (operator toggles). New rows default general_auto_reaction_enabled to true.
func (s *Store) UpsertDiscoveredCompanyChannels(ctx context.Context, hashKey string, in []DiscoveredChannelInput) ([]string, error) {
	rdb := s.companyChannelsRedis()
	if s == nil || rdb == nil {
		return nil, fmt.Errorf("company channels: nil store")
	}
	k := companyChannelsHashKey(hashKey)
	var touched []string
	for i, row := range in {
		if i >= maxDiscoverChannels {
			break
		}
		cid := strings.TrimSpace(row.ChannelID)
		if cid == "" {
			continue
		}
		var e CompanyChannel
		var hadStoredRow bool
		var prevGeneralAutoReaction bool
		raw, err := rdb.HGet(ctx, k, cid).Result()
		if err != nil && err != redis.Nil {
			return touched, err
		}
		if err == nil && strings.TrimSpace(raw) != "" {
			if uerr := json.Unmarshal([]byte(raw), &e); uerr != nil {
				e = CompanyChannel{}
			} else {
				hadStoredRow = true
				prevGeneralAutoReaction = e.GeneralAutoReactionEnabled
			}
		}
		e = normalizeCompanyChannel(e, cid)
		ooo := e.OutOfOfficeEnabled
		grm := e.GeneralResponsesMuted
		dn := strings.TrimSpace(row.Name)
		if dn != "" {
			e.DisplayName = dn
		}
		if slug := slugFromSlackChannelDisplayName(row.Name); slug != "" {
			if strings.TrimSpace(e.CompanySlug) == "" {
				e.CompanySlug = slug
			}
		}
		e.ChannelID = cid
		e.ThreadsEnabled = true
		if hadStoredRow {
			e.GeneralAutoReactionEnabled = prevGeneralAutoReaction
		} else {
			e.GeneralAutoReactionEnabled = true
		}
		e.OutOfOfficeEnabled = ooo
		e.GeneralResponsesMuted = grm
		if len(row.OwnerIDs) > 0 {
			e.OwnerIDs = dedupeTrimmedIDs(row.OwnerIDs, maxOwnerIDsPerChannel)
		}
		e = normalizeCompanyChannel(e, cid)
		b, err := json.Marshal(e)
		if err != nil {
			return touched, err
		}
		if err := rdb.HSet(ctx, k, cid, string(b)).Err(); err != nil {
			return touched, err
		}
		if pubErr := rdb.Publish(ctx, companyChannelsInvalidatePubSubChannel, cid).Err(); pubErr != nil {
			log.Printf("company channels discover: invalidate publish: %v", pubErr)
		}
		touched = append(touched, cid)
	}
	return touched, nil
}

func dedupeTrimmedIDs(ids []string, maxN int) []string {
	seen := make(map[string]struct{})
	var out []string
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
		if len(out) >= maxN {
			break
		}
	}
	return out
}

func slugFromSlackChannelDisplayName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.TrimPrefix(strings.ToLower(name), "#")
	name = strings.TrimSpace(name)
	var b strings.Builder
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			b.WriteRune(r)
		}
	}
	return strings.Trim(b.String(), "-")
}

const channelKnowledgeRedisKeyFmt = "employee-factory:channel_knowledge:%s:markdown"

// GetChannelKnowledgeMarkdown returns the stored hourly digest markdown for a Slack channel id
// (same key employee-factory uses in Redis). Empty string with no error if missing.
func (s *Store) GetChannelKnowledgeMarkdown(ctx context.Context, channelID string) (string, error) {
	rdb := s.companyChannelsRedis()
	if s == nil || rdb == nil {
		return "", fmt.Errorf("channel knowledge: nil store")
	}
	ch := strings.TrimSpace(channelID)
	if ch == "" {
		return "", nil
	}
	key := fmt.Sprintf(channelKnowledgeRedisKeyFmt, ch)
	raw, err := rdb.Get(ctx, key).Result()
	if err == redis.Nil {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return raw, nil
}

// ListCapabilityRoutingObsEvents returns recent JSON objects from the shared Redis LIST (newest first from LRANGE).
// Uses the company-channels Redis client when configured (same host employee-factory LPUSHes to; see COMPANY_CHANNELS_REDIS_URL).
func (s *Store) ListCapabilityRoutingObsEvents(ctx context.Context, listKey, channelID string, limit int) ([]json.RawMessage, error) {
	rdb := s.companyChannelsRedis()
	if s == nil || rdb == nil {
		return nil, fmt.Errorf("capability routing obs: nil store")
	}
	k := strings.TrimSpace(listKey)
	if k == "" {
		return nil, fmt.Errorf("capability routing obs: empty list key")
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	raws, err := rdb.LRange(ctx, k, 0, int64(limit*5-1)).Result()
	if err != nil {
		return nil, err
	}
	out := make([]json.RawMessage, 0, limit)
	chFilter := strings.TrimSpace(channelID)
	for _, line := range raws {
		if chFilter != "" {
			var probe struct {
				ChannelID string `json:"channel_id"`
			}
			if json.Unmarshal([]byte(line), &probe) != nil || probe.ChannelID != chFilter {
				continue
			}
		}
		out = append(out, json.RawMessage(line))
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}
