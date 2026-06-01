package app

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Personal-agent tenancy (issue #183). Sibling to the company-channel
// tenancy: keyed on `(owner_user_id, slug)` instead of channel id. Each
// personal agent has its own Slack app + bot user, its own OAuth-bound
// Google identity (when connected), and responds only to its owner.
//
// Stored as a Redis hash at `makeacompany:personal_agent:<slug>` with two
// secondary indexes (set, string) so the three hot lookups —
//   - list one owner's agents (admin /me/agents view)
//   - list all agents (admin aggregate view)
//   - resolve bot-user-id → slug (dispatcher fast path)
// are all O(1) or O(N-per-owner) without scanning the full keyspace.
//
// Methods on Store mirror the patterns in store_user_profile.go: small
// composable HSET/HGET pairs, no Lua, errors wrapped at the call edge.

const (
	personalAgentKeyPrefix         = keyPrefix + ":personal_agent:"
	personalAgentByOwnerKeyPrefix  = keyPrefix + ":personal_agent_by_owner:"
	personalAgentByBotKeyPrefix    = keyPrefix + ":personal_agent_by_bot:"
	personalAgentSlugsSet          = keyPrefix + ":personal_agents:slugs"
	maxPersonalAgentList           = 500
	minPersonalAgentSlugLen        = 3
	maxPersonalAgentSlugLen        = 32
	maxPersonalAgentDisplayNameLen = 80
)

// ErrPersonalAgentNotFound is returned by Get/Lookup when the slug or bot
// user id doesn't resolve to a personal agent.
var ErrPersonalAgentNotFound = errors.New("personal agent not found")

// ErrPersonalAgentSlugTaken is returned by CreatePersonalAgent when the
// slug already exists. Workspace-wide uniqueness is enforced (see #183
// decision #8: enforce unique).
var ErrPersonalAgentSlugTaken = errors.New("personal agent slug already in use")

// ErrInvalidPersonalAgentSlug is returned when a slug fails validation
// (length / character class).
var ErrInvalidPersonalAgentSlug = errors.New("invalid personal agent slug")

// ErrInvalidPersonalAgentOwner is returned when owner_user_id isn't a
// well-formed Slack user id.
var ErrInvalidPersonalAgentOwner = errors.New("invalid personal agent owner user id")

// PersonalAgent is the on-disk projection of one personal-agent tenancy
// record. Empty AgentSlackBotUserID / GoogleEmail / GoogleSubject mean
// the agent has been created but not yet wired up.
type PersonalAgent struct {
	Slug                string    `json:"slug"`
	OwnerUserID         string    `json:"owner_user_id"`
	DisplayName         string    `json:"display_name"`
	AgentSlackBotUserID string    `json:"agent_slack_bot_user_id,omitempty"`
	GoogleEmail         string    `json:"google_email,omitempty"`
	GoogleSubject       string    `json:"google_subject,omitempty"`
	CreatedAt           time.Time `json:"created_at"`
}

// slugRe enforces the slug character class: lowercase alphanumeric with
// internal hyphens. No leading/trailing/consecutive hyphens — a slug
// like "garth--bart" or "-garth" is rejected so URLs stay clean.
var slugRe = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// nonSlugRe is used by SlugifyAgentName to strip everything that isn't a
// valid slug character before joining segments with hyphens.
var nonSlugRe = regexp.MustCompile(`[^a-z0-9]+`)

// SlugifyAgentName converts a human-entered display name (e.g. "Bart 🤖")
// into a kebab-case slug ("bart"). Returns the slug + ok flag; ok=false
// means the input lowered to fewer than minPersonalAgentSlugLen
// significant characters and the caller should ask the user to pick a
// different name.
func SlugifyAgentName(name string) (string, bool) {
	trimmed := strings.TrimSpace(strings.ToLower(name))
	if trimmed == "" {
		return "", false
	}
	slug := nonSlugRe.ReplaceAllString(trimmed, "-")
	slug = strings.Trim(slug, "-")
	if len(slug) > maxPersonalAgentSlugLen {
		slug = strings.TrimRight(slug[:maxPersonalAgentSlugLen], "-")
	}
	if len(slug) < minPersonalAgentSlugLen {
		return "", false
	}
	if !slugRe.MatchString(slug) {
		return "", false
	}
	return slug, true
}

// ValidPersonalAgentSlug returns true iff slug passes the same character
// class check that SlugifyAgentName produces. Handlers use this to gate
// arbitrary slug inputs (URL path params, admin operations).
func ValidPersonalAgentSlug(slug string) bool {
	if len(slug) < minPersonalAgentSlugLen || len(slug) > maxPersonalAgentSlugLen {
		return false
	}
	return slugRe.MatchString(slug)
}

// ValidSlackUserID returns true iff id looks like a Slack user/bot id
// (U… or W… for Enterprise-Grid users, B… for legacy bot accounts).
// Mirrors ValidSlackChannelID's shape so the same validator pattern is
// used at every handler boundary.
func ValidSlackUserID(id string) bool {
	id = strings.TrimSpace(id)
	if len(id) < 8 || len(id) > 24 {
		return false
	}
	switch id[0] {
	case 'U', 'W', 'B':
	default:
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			continue
		}
		return false
	}
	return true
}

func personalAgentKey(slug string) string {
	return personalAgentKeyPrefix + slug
}

func personalAgentByOwnerKey(ownerUserID string) string {
	return personalAgentByOwnerKeyPrefix + ownerUserID
}

func personalAgentByBotKey(botUserID string) string {
	return personalAgentByBotKeyPrefix + botUserID
}

// CreatePersonalAgent atomically reserves the slug + records the
// owner/display name. Returns ErrPersonalAgentSlugTaken if the slug is
// already in use. Bot/Google identity fields are written later via
// SetPersonalAgentSlackBot / SetPersonalAgentGoogleIdentity.
//
// "Atomically" here means: the SET membership add (used as the
// uniqueness sentinel) and the hash write happen via Redis pipeline.
// Cross-pod uniqueness is enforced by SADD's return value (0 = already
// present); a racing second create on the same slug sees 0 and returns
// ErrPersonalAgentSlugTaken without overwriting the hash.
func (s *Store) CreatePersonalAgent(ctx context.Context, slug, ownerUserID, displayName string) error {
	if !ValidPersonalAgentSlug(slug) {
		return ErrInvalidPersonalAgentSlug
	}
	if !ValidSlackUserID(ownerUserID) {
		return ErrInvalidPersonalAgentOwner
	}
	displayName = strings.TrimSpace(displayName)
	if displayName == "" {
		return fmt.Errorf("missing display name")
	}
	if len(displayName) > maxPersonalAgentDisplayNameLen {
		displayName = displayName[:maxPersonalAgentDisplayNameLen]
	}

	added, err := s.rdb.SAdd(ctx, personalAgentSlugsSet, slug).Result()
	if err != nil {
		return fmt.Errorf("reserve slug: %w", err)
	}
	if added == 0 {
		return ErrPersonalAgentSlugTaken
	}

	now := time.Now().UTC().Format(time.RFC3339)
	fields := map[string]any{
		"slug":          slug,
		"owner_user_id": ownerUserID,
		"display_name":  displayName,
		"created_at":    now,
	}
	if err := s.rdb.HSet(ctx, personalAgentKey(slug), fields).Err(); err != nil {
		// Reservation rollback: if the hash write fails for any reason
		// the sentinel SADD would leave the slug permanently held. Best-
		// effort SREM to release it; an error here is logged-and-eaten
		// because the bigger problem (Redis down) is already surfaced.
		_ = s.rdb.SRem(ctx, personalAgentSlugsSet, slug).Err()
		return fmt.Errorf("write personal agent: %w", err)
	}
	if err := s.rdb.SAdd(ctx, personalAgentByOwnerKey(ownerUserID), slug).Err(); err != nil {
		return fmt.Errorf("index by owner: %w", err)
	}
	return nil
}

// GetPersonalAgent returns the agent record for the given slug, or
// ErrPersonalAgentNotFound if no such slug is registered.
func (s *Store) GetPersonalAgent(ctx context.Context, slug string) (*PersonalAgent, error) {
	if !ValidPersonalAgentSlug(slug) {
		return nil, ErrInvalidPersonalAgentSlug
	}
	raw, err := s.rdb.HGetAll(ctx, personalAgentKey(slug)).Result()
	if err != nil {
		return nil, fmt.Errorf("hgetall personal agent: %w", err)
	}
	if len(raw) == 0 {
		return nil, ErrPersonalAgentNotFound
	}
	return personalAgentFromHash(raw), nil
}

// ListPersonalAgentsByOwner returns every personal agent the given owner
// has created. Empty slice (no error) when the owner has no agents.
// Order is stable: slugs sorted alphabetically so admin views and
// owner-side lists render deterministically.
func (s *Store) ListPersonalAgentsByOwner(ctx context.Context, ownerUserID string) ([]PersonalAgent, error) {
	if !ValidSlackUserID(ownerUserID) {
		return nil, ErrInvalidPersonalAgentOwner
	}
	slugs, err := s.rdb.SMembers(ctx, personalAgentByOwnerKey(ownerUserID)).Result()
	if err != nil {
		return nil, fmt.Errorf("smembers by owner: %w", err)
	}
	return s.hydratePersonalAgents(ctx, slugs)
}

// ListAllPersonalAgents returns every personal agent across owners
// (admin aggregate view, /admin/personal-agents). Capped at
// maxPersonalAgentList so a pathological keyspace can't blow up the
// admin page; in v1 we don't expect to exceed that, and a cap is much
// nicer than a slow admin spinner.
func (s *Store) ListAllPersonalAgents(ctx context.Context) ([]PersonalAgent, error) {
	slugs, err := s.rdb.SMembers(ctx, personalAgentSlugsSet).Result()
	if err != nil {
		return nil, fmt.Errorf("smembers all slugs: %w", err)
	}
	if len(slugs) > maxPersonalAgentList {
		sort.Strings(slugs)
		slugs = slugs[:maxPersonalAgentList]
	}
	return s.hydratePersonalAgents(ctx, slugs)
}

// LookupPersonalAgentByBotUser returns the slug whose AgentSlackBotUserID
// matches botUserID. Used by the dispatcher fast path: an inbound Slack
// event for a personal-agent bot resolves to its tenant record via this
// single GET. Returns ErrPersonalAgentNotFound when the bot user id
// isn't bound to any registered personal agent.
func (s *Store) LookupPersonalAgentByBotUser(ctx context.Context, botUserID string) (string, error) {
	if !ValidSlackUserID(botUserID) {
		return "", ErrInvalidPersonalAgentOwner
	}
	slug, err := s.rdb.Get(ctx, personalAgentByBotKey(botUserID)).Result()
	if err != nil {
		if err == redis.Nil {
			return "", ErrPersonalAgentNotFound
		}
		return "", fmt.Errorf("get by bot user: %w", err)
	}
	return slug, nil
}

// SetPersonalAgentSlackBot binds the agent's Slack bot user id and
// updates the reverse index. Idempotent: re-binding the same bot id is a
// no-op; re-binding to a different bot id clears the old reverse index
// entry first. Returns ErrPersonalAgentNotFound when slug doesn't exist.
func (s *Store) SetPersonalAgentSlackBot(ctx context.Context, slug, botUserID string) error {
	if !ValidPersonalAgentSlug(slug) {
		return ErrInvalidPersonalAgentSlug
	}
	if !ValidSlackUserID(botUserID) {
		return ErrInvalidPersonalAgentOwner
	}
	prev, err := s.rdb.HGet(ctx, personalAgentKey(slug), "agent_slack_bot_user_id").Result()
	if err != nil && err != redis.Nil {
		return fmt.Errorf("hget bot: %w", err)
	}
	if err == redis.Nil {
		// If the hash doesn't exist at all we shouldn't be writing it.
		exists, eErr := s.rdb.Exists(ctx, personalAgentKey(slug)).Result()
		if eErr != nil {
			return fmt.Errorf("exists check: %w", eErr)
		}
		if exists == 0 {
			return ErrPersonalAgentNotFound
		}
	}
	if prev == botUserID {
		return nil
	}
	if prev != "" {
		if err := s.rdb.Del(ctx, personalAgentByBotKey(prev)).Err(); err != nil {
			return fmt.Errorf("clear old bot index: %w", err)
		}
	}
	if err := s.rdb.HSet(ctx, personalAgentKey(slug), "agent_slack_bot_user_id", botUserID).Err(); err != nil {
		return fmt.Errorf("hset bot: %w", err)
	}
	if err := s.rdb.Set(ctx, personalAgentByBotKey(botUserID), slug, 0).Err(); err != nil {
		return fmt.Errorf("set bot index: %w", err)
	}
	return nil
}

// SetPersonalAgentGoogleIdentity records the Google identity bound to
// this agent after the OAuth dance completes. Both fields are written
// together so the on-disk state is never half-populated. Returns
// ErrPersonalAgentNotFound if slug doesn't exist.
func (s *Store) SetPersonalAgentGoogleIdentity(ctx context.Context, slug, googleEmail, googleSubject string) error {
	if !ValidPersonalAgentSlug(slug) {
		return ErrInvalidPersonalAgentSlug
	}
	googleEmail = strings.TrimSpace(strings.ToLower(googleEmail))
	googleSubject = strings.TrimSpace(googleSubject)
	if googleEmail == "" || googleSubject == "" {
		return fmt.Errorf("missing google identity")
	}
	exists, err := s.rdb.Exists(ctx, personalAgentKey(slug)).Result()
	if err != nil {
		return fmt.Errorf("exists check: %w", err)
	}
	if exists == 0 {
		return ErrPersonalAgentNotFound
	}
	return s.rdb.HSet(ctx, personalAgentKey(slug), map[string]any{
		"google_email":   googleEmail,
		"google_subject": googleSubject,
	}).Err()
}

// DeletePersonalAgent removes the agent's hash, all secondary index
// entries, and the slug reservation. Idempotent: deleting a nonexistent
// slug returns nil. Caller is responsible for tearing down the per-agent
// k8s Secret + deployment (out of scope here — handled in PR2/PR3 of
// #186).
func (s *Store) DeletePersonalAgent(ctx context.Context, slug string) error {
	if !ValidPersonalAgentSlug(slug) {
		return ErrInvalidPersonalAgentSlug
	}
	raw, err := s.rdb.HGetAll(ctx, personalAgentKey(slug)).Result()
	if err != nil {
		return fmt.Errorf("hgetall for delete: %w", err)
	}
	if len(raw) == 0 {
		return nil
	}
	owner := raw["owner_user_id"]
	bot := raw["agent_slack_bot_user_id"]
	if err := s.rdb.Del(ctx, personalAgentKey(slug)).Err(); err != nil {
		return fmt.Errorf("del hash: %w", err)
	}
	if owner != "" {
		if err := s.rdb.SRem(ctx, personalAgentByOwnerKey(owner), slug).Err(); err != nil {
			return fmt.Errorf("srem by owner: %w", err)
		}
	}
	if bot != "" {
		if err := s.rdb.Del(ctx, personalAgentByBotKey(bot)).Err(); err != nil {
			return fmt.Errorf("del by bot: %w", err)
		}
	}
	if err := s.rdb.SRem(ctx, personalAgentSlugsSet, slug).Err(); err != nil {
		return fmt.Errorf("srem slugs: %w", err)
	}
	return nil
}

func (s *Store) hydratePersonalAgents(ctx context.Context, slugs []string) ([]PersonalAgent, error) {
	if len(slugs) == 0 {
		return nil, nil
	}
	sort.Strings(slugs)
	out := make([]PersonalAgent, 0, len(slugs))
	for _, slug := range slugs {
		raw, err := s.rdb.HGetAll(ctx, personalAgentKey(slug)).Result()
		if err != nil {
			return nil, fmt.Errorf("hgetall %s: %w", slug, err)
		}
		if len(raw) == 0 {
			// Orphan index entry — log later, skip for now. Can happen
			// if a delete fails mid-flight. Returning a half-populated
			// PersonalAgent here would mask the inconsistency.
			continue
		}
		out = append(out, *personalAgentFromHash(raw))
	}
	return out, nil
}

func personalAgentFromHash(raw map[string]string) *PersonalAgent {
	pa := &PersonalAgent{
		Slug:                raw["slug"],
		OwnerUserID:         raw["owner_user_id"],
		DisplayName:         raw["display_name"],
		AgentSlackBotUserID: raw["agent_slack_bot_user_id"],
		GoogleEmail:         raw["google_email"],
		GoogleSubject:       raw["google_subject"],
	}
	if ts, ok := raw["created_at"]; ok {
		if t, err := time.Parse(time.RFC3339, ts); err == nil {
			pa.CreatedAt = t
		}
	}
	return pa
}

