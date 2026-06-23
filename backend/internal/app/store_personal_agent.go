package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	personalAgentKeyPrefix              = keyPrefix + ":personal_agent:"
	personalAgentByOwnerPrefix          = keyPrefix + ":personal_agent_by_owner:"
	personalAgentByAppIDPrefix          = keyPrefix + ":personal_agent_by_app:"
	personalAgentByKnowledgeTokenPrefix = keyPrefix + ":personal_agent_by_knowledge_token:"

	PersonalAgentStatusPendingInstall = "pending_install"
	PersonalAgentStatusInstalled      = "installed"
	PersonalAgentStatusFailed         = "failed"

	// Visibility of an agent's public showcase page (see #657). Default
	// (empty / unset) is treated as private: the owner opts in before any
	// public surface renders. unlisted = reachable by direct link but not
	// listed or indexed; public = also eligible for listing/indexing.
	PersonalAgentVisibilityPrivate  = "private"
	PersonalAgentVisibilityUnlisted = "unlisted"
	PersonalAgentVisibilityPublic   = "public"
)

// effectivePersonalAgentVisibility normalizes a stored visibility value.
// Empty (never set, or a record predating #657) is private — fail closed.
func effectivePersonalAgentVisibility(raw string) string {
	switch strings.TrimSpace(raw) {
	case PersonalAgentVisibilityUnlisted:
		return PersonalAgentVisibilityUnlisted
	case PersonalAgentVisibilityPublic:
		return PersonalAgentVisibilityPublic
	default:
		return PersonalAgentVisibilityPrivate
	}
}

// PersonalAgentRecord is the durable shape of one provisioned personal agent.
// Bot tokens never live here — those go in per-agent K8s Secrets (see
// PersonalAgentWriter). The Slack app credentials (client_id / client_secret
// / signing_secret) we keep here so the install-complete handler can finish
// the OAuth dance without re-reading the K8s Secret.
type PersonalAgentRecord struct {
	ID                string `json:"id"`
	OwnerEmail        string `json:"ownerEmail"`
	OwnerSlackUserID  string `json:"ownerSlackUserId"`
	DisplayName       string `json:"displayName"`
	Description       string `json:"description"`
	LongDescription   string `json:"longDescription,omitempty"`
	// Visibility gates the public showcase page (#657): private (default) /
	// unlisted / public. Empty is treated as private by
	// effectivePersonalAgentVisibility — records predating #657 stay closed.
	Visibility        string `json:"visibility,omitempty"`
	// ShowIntelligence is a separate opt-in from Visibility: when true the
	// public page renders the agent's harvested knowledge (YouTube source
	// titles + bullets) as a selling point. Default false. Never exposes the
	// raw SystemPrompt or any token regardless of this flag.
	ShowIntelligence  bool   `json:"showIntelligence,omitempty"`
	// SystemPrompt is the user-defined persona / system prompt rendered into
	// instructions.md by the PA wrapper. Stored here so the modal can
	// hydrate AND so spawned-pod restarts re-read the latest value from the
	// per-agent Secret.
	SystemPrompt      string `json:"systemPrompt,omitempty"`
	SlackAppID        string `json:"slackAppId"`
	SlackClientID     string `json:"slackClientId"`
	SlackClientSecret string `json:"slackClientSecret"`
	SlackSigningSecret string `json:"slackSigningSecret"`
	OAuthAuthorizeURL string `json:"oauthAuthorizeUrl"`
	// ServiceNamespace + ServiceName + ServicePort describe the in-cluster
	// endpoint the events gateway forwards inbound Slack events to. Populated
	// either at provisioning time (using the deterministic per-agent
	// convention) or by an out-of-band operator step for the first MVP agent.
	ServiceNamespace string `json:"serviceNamespace"`
	ServiceName      string `json:"serviceName"`
	ServicePort      int    `json:"servicePort"`
	// BotUserID is the Slack user id of the installed app's bot user, captured
	// from oauth.v2.access on install-complete. Used to fetch the bot's live
	// profile image URL via users.info on /me load. Optional — historical
	// records may have this empty; the icon-current endpoint lazy-fills via
	// auth.test on the per-agent bot token if missing.
	BotUserID        string `json:"botUserId,omitempty"`
	// YouTubeSources is the list of harvested-from-YouTube intelligence
	// blocks the user has ingested onto this agent's persona. Each entry
	// renders into the runtime PERSONAL_AGENT_SYSTEM_PROMPT (see
	// renderPersonalAgentRuntimePrompt). The user-edited SystemPrompt
	// stays the source of truth for the typed persona; bullets are
	// additive.
	YouTubeSources   []PersonalAgentYouTubeSource `json:"youtubeSources,omitempty"`
	// KnowledgeToken is the per-agent bearer the in-cluster personal-agent pod
	// presents to GET /v1/personal-agents/knowledge so it can lazy-load
	// harvested intelligence (see #607). Random hex, minted at provision; the
	// only path back to the agent id is via the by-knowledge-token index.
	// Never returned by the /me handler.
	KnowledgeToken    string `json:"-"`
	Status            string `json:"status"`
	CreatedAt         string `json:"createdAt"`
	UpdatedAt         string `json:"updatedAt"`
}

// PersonalAgentYouTubeSource is one harvested-from-YouTube intelligence
// block. URL is canonical identity (used for dedupe + delete).
type PersonalAgentYouTubeSource struct {
	URL        string   `json:"url"`
	Title      string   `json:"title,omitempty"`
	Bullets    []string `json:"bullets"`
	IngestedAt string   `json:"ingestedAt"`
}

func personalAgentRedisKey(agentID string) string {
	return personalAgentKeyPrefix + strings.TrimSpace(agentID)
}
func personalAgentByOwnerRedisKey(slackUserID string) string {
	return personalAgentByOwnerPrefix + strings.TrimSpace(slackUserID)
}
func personalAgentByAppRedisKey(appID string) string {
	return personalAgentByAppIDPrefix + strings.TrimSpace(appID)
}
func personalAgentByKnowledgeTokenRedisKey(token string) string {
	return personalAgentByKnowledgeTokenPrefix + strings.TrimSpace(token)
}

// ErrPersonalAgentExists is returned by CreatePersonalAgent when the owner
// already has an agent (one-per-user enforcement; revisit when product
// allows multiple).
var ErrPersonalAgentExists = errors.New("personal agent already exists for owner")

// CreatePersonalAgent writes the record, the by-owner index, and the
// by-app-id index in a single transaction. Fails closed if the owner already
// has an agent.
func (s *Store) CreatePersonalAgent(ctx context.Context, rec PersonalAgentRecord) error {
	if strings.TrimSpace(rec.ID) == "" || strings.TrimSpace(rec.OwnerSlackUserID) == "" || strings.TrimSpace(rec.SlackAppID) == "" {
		return errors.New("CreatePersonalAgent: id, owner slack user id, slack app id required")
	}
	if rec.Status == "" {
		rec.Status = PersonalAgentStatusPendingInstall
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if rec.CreatedAt == "" {
		rec.CreatedAt = now
	}
	rec.UpdatedAt = now

	ownerKey := personalAgentByOwnerRedisKey(rec.OwnerSlackUserID)
	existing, err := s.rdb.Get(ctx, ownerKey).Result()
	switch err {
	case nil:
		if existing != "" {
			return fmt.Errorf("%w (existing id=%s)", ErrPersonalAgentExists, existing)
		}
	case redis.Nil:
		// no existing — proceed
	default:
		return fmt.Errorf("check existing owner mapping: %w", err)
	}

	mainKey := personalAgentRedisKey(rec.ID)
	appKey := personalAgentByAppRedisKey(rec.SlackAppID)

	pipe := s.rdb.TxPipeline()
	pipe.HSet(ctx, mainKey, recordToHash(rec))
	pipe.Set(ctx, ownerKey, rec.ID, 0)
	pipe.Set(ctx, appKey, rec.ID, 0)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("persist personal agent: %w", err)
	}
	return nil
}

// GetPersonalAgent returns the record for an agent id, redis.Nil when absent.
func (s *Store) GetPersonalAgent(ctx context.Context, agentID string) (PersonalAgentRecord, error) {
	vals, err := s.rdb.HGetAll(ctx, personalAgentRedisKey(agentID)).Result()
	if err != nil {
		return PersonalAgentRecord{}, err
	}
	if len(vals) == 0 {
		return PersonalAgentRecord{}, redis.Nil
	}
	return hashToRecord(vals), nil
}

// GetPersonalAgentByOwner is the lookup used by the /me UI to find whether
// the signed-in user already has an agent.
func (s *Store) GetPersonalAgentByOwner(ctx context.Context, slackUserID string) (PersonalAgentRecord, error) {
	id, err := s.rdb.Get(ctx, personalAgentByOwnerRedisKey(slackUserID)).Result()
	if err != nil {
		return PersonalAgentRecord{}, err
	}
	return s.GetPersonalAgent(ctx, id)
}

// GetPersonalAgentByAppID is the lookup used by the events gateway to route
// inbound Slack events to the right in-cluster service.
func (s *Store) GetPersonalAgentByAppID(ctx context.Context, appID string) (PersonalAgentRecord, error) {
	id, err := s.rdb.Get(ctx, personalAgentByAppRedisKey(appID)).Result()
	if err != nil {
		return PersonalAgentRecord{}, err
	}
	return s.GetPersonalAgent(ctx, id)
}

// MarkPersonalAgentInstalled flips status → installed and stamps UpdatedAt.
// Bot token is NOT stored here — it landed in K8s via PersonalAgentWriter.
func (s *Store) MarkPersonalAgentInstalled(ctx context.Context, agentID string) error {
	return s.updatePersonalAgentFields(ctx, agentID, map[string]any{
		"status":     PersonalAgentStatusInstalled,
		"updated_at": time.Now().UTC().Format(time.RFC3339),
	})
}

// SetPersonalAgentService records the in-cluster Service the gateway should
// forward to. Called either by the operator after rancher-admin#1057 lands,
// or by the productized provisioner once it generates the Deployment.
func (s *Store) SetPersonalAgentService(ctx context.Context, agentID, namespace, name string, port int) error {
	if strings.TrimSpace(namespace) == "" || strings.TrimSpace(name) == "" || port <= 0 {
		return errors.New("SetPersonalAgentService: namespace, name, port required")
	}
	return s.updatePersonalAgentFields(ctx, agentID, map[string]any{
		"service_namespace": namespace,
		"service_name":      name,
		"service_port":      port,
		"updated_at":        time.Now().UTC().Format(time.RFC3339),
	})
}

// UpdatePersonalAgentDisplay edits the user-visible name + description on
// an existing record. The owner index doesn't move (slack_user_id is
// immutable) and neither does the by-app-id index.
// UpdatePersonalAgentDisplay edits the user-visible name + description on
// an existing record. Pass empty string for any field you don't want to
// change. systemPrompt is a special-case: empty string means "no change" same
// as the others, but if you want to CLEAR the persona back to the blank-slate
// default, use UpdatePersonalAgentSystemPrompt(ctx, id, "").
func (s *Store) UpdatePersonalAgentDisplay(ctx context.Context, agentID, displayName, description, longDescription, systemPrompt string) error {
	fields := map[string]any{"updated_at": time.Now().UTC().Format(time.RFC3339)}
	if v := strings.TrimSpace(displayName); v != "" {
		fields["display_name"] = v
	}
	if v := strings.TrimSpace(description); v != "" {
		fields["description"] = v
	}
	if v := strings.TrimSpace(longDescription); v != "" {
		fields["long_description"] = v
	}
	if v := strings.TrimSpace(systemPrompt); v != "" {
		fields["system_prompt"] = v
	}
	return s.updatePersonalAgentFields(ctx, agentID, fields)
}

// SetPersonalAgentVisibility updates the public-showcase visibility (#657)
// and the separate show-intelligence opt-in. visibility is normalized to one
// of private/unlisted/public; an unrecognized value falls back to private.
// showIntelligence is applied only when non-nil, so callers can change one
// switch without touching the other.
func (s *Store) SetPersonalAgentVisibility(ctx context.Context, agentID, visibility string, showIntelligence *bool) error {
	fields := map[string]any{
		"visibility": effectivePersonalAgentVisibility(visibility),
		"updated_at": time.Now().UTC().Format(time.RFC3339),
	}
	if showIntelligence != nil {
		fields["show_intelligence"] = boolToHash(*showIntelligence)
	}
	return s.updatePersonalAgentFields(ctx, agentID, fields)
}

// AppendPersonalAgentYouTubeSource adds a harvested-from-YouTube intelligence
// block to the agent's sources list, deduping on URL (newest wins). Returns
// the updated record so the caller can re-render PERSONAL_AGENT_SYSTEM_PROMPT
// without a second read.
func (s *Store) AppendPersonalAgentYouTubeSource(ctx context.Context, agentID string, source PersonalAgentYouTubeSource) (PersonalAgentRecord, error) {
	if strings.TrimSpace(source.URL) == "" {
		return PersonalAgentRecord{}, errors.New("AppendPersonalAgentYouTubeSource: url required")
	}
	rec, err := s.GetPersonalAgent(ctx, agentID)
	if err != nil {
		return PersonalAgentRecord{}, err
	}
	filtered := make([]PersonalAgentYouTubeSource, 0, len(rec.YouTubeSources)+1)
	for _, existing := range rec.YouTubeSources {
		if existing.URL != source.URL {
			filtered = append(filtered, existing)
		}
	}
	filtered = append(filtered, source)
	rec.YouTubeSources = filtered
	if err := s.updatePersonalAgentFields(ctx, agentID, map[string]any{
		"youtube_sources": marshalYouTubeSources(filtered),
		"updated_at":      time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return PersonalAgentRecord{}, err
	}
	return rec, nil
}

// RemovePersonalAgentYouTubeSource drops the source matching URL. No-op when
// URL is absent; returns the (possibly unchanged) updated record either way.
func (s *Store) RemovePersonalAgentYouTubeSource(ctx context.Context, agentID, url string) (PersonalAgentRecord, error) {
	if strings.TrimSpace(url) == "" {
		return PersonalAgentRecord{}, errors.New("RemovePersonalAgentYouTubeSource: url required")
	}
	rec, err := s.GetPersonalAgent(ctx, agentID)
	if err != nil {
		return PersonalAgentRecord{}, err
	}
	filtered := make([]PersonalAgentYouTubeSource, 0, len(rec.YouTubeSources))
	for _, existing := range rec.YouTubeSources {
		if existing.URL != url {
			filtered = append(filtered, existing)
		}
	}
	rec.YouTubeSources = filtered
	if err := s.updatePersonalAgentFields(ctx, agentID, map[string]any{
		"youtube_sources": marshalYouTubeSources(filtered),
		"updated_at":      time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return PersonalAgentRecord{}, err
	}
	return rec, nil
}

// DeletePersonalAgent removes the agent record + both indexes in a single
// transaction. Caller is responsible for cleaning up the Slack app and K8s
// resources first; this is the durable-state final step.
func (s *Store) DeletePersonalAgent(ctx context.Context, rec PersonalAgentRecord) error {
	if strings.TrimSpace(rec.ID) == "" {
		return errors.New("DeletePersonalAgent: id required")
	}
	pipe := s.rdb.TxPipeline()
	pipe.Del(ctx, personalAgentRedisKey(rec.ID))
	if rec.OwnerSlackUserID != "" {
		pipe.Del(ctx, personalAgentByOwnerRedisKey(rec.OwnerSlackUserID))
	}
	if rec.SlackAppID != "" {
		pipe.Del(ctx, personalAgentByAppRedisKey(rec.SlackAppID))
	}
	if rec.KnowledgeToken != "" {
		pipe.Del(ctx, personalAgentByKnowledgeTokenRedisKey(rec.KnowledgeToken))
	}
	_, err := pipe.Exec(ctx)
	return err
}

// SetPersonalAgentBotUserID stores the Slack bot user id resolved at OAuth
// install (or lazily via auth.test on first icon-current fetch).
func (s *Store) SetPersonalAgentBotUserID(ctx context.Context, agentID, botUserID string) error {
	return s.updatePersonalAgentFields(ctx, agentID, map[string]any{
		"bot_user_id": botUserID,
		"updated_at":  time.Now().UTC().Format(time.RFC3339),
	})
}

// UpdatePersonalAgentStatus flips status to an arbitrary value (e.g. "failed").
func (s *Store) UpdatePersonalAgentStatus(ctx context.Context, agentID, status string) error {
	return s.updatePersonalAgentFields(ctx, agentID, map[string]any{
		"status":     status,
		"updated_at": time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Store) updatePersonalAgentFields(ctx context.Context, agentID string, fields map[string]any) error {
	key := personalAgentRedisKey(agentID)
	exists, err := s.rdb.Exists(ctx, key).Result()
	if err != nil {
		return err
	}
	if exists == 0 {
		return redis.Nil
	}
	return s.rdb.HSet(ctx, key, fields).Err()
}

func recordToHash(r PersonalAgentRecord) map[string]any {
	return map[string]any{
		"id":                  r.ID,
		"owner_email":         r.OwnerEmail,
		"owner_slack_user_id": r.OwnerSlackUserID,
		"display_name":        r.DisplayName,
		"description":         r.Description,
		"long_description":    r.LongDescription,
		"visibility":          r.Visibility,
		"show_intelligence":   boolToHash(r.ShowIntelligence),
		"system_prompt":       r.SystemPrompt,
		"slack_app_id":        r.SlackAppID,
		"slack_client_id":     r.SlackClientID,
		"slack_client_secret": r.SlackClientSecret,
		"slack_signing_secret": r.SlackSigningSecret,
		"oauth_authorize_url": r.OAuthAuthorizeURL,
		"service_namespace":   r.ServiceNamespace,
		"service_name":        r.ServiceName,
		"service_port":        r.ServicePort,
		"bot_user_id":         r.BotUserID,
		"youtube_sources":     marshalYouTubeSources(r.YouTubeSources),
		"knowledge_token":     r.KnowledgeToken,
		"status":              r.Status,
		"created_at":          r.CreatedAt,
		"updated_at":          r.UpdatedAt,
	}
}

func boolToHash(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func hashToBool(raw string) bool {
	switch strings.TrimSpace(raw) {
	case "1", "true", "TRUE", "True":
		return true
	default:
		return false
	}
}

func marshalYouTubeSources(sources []PersonalAgentYouTubeSource) string {
	if len(sources) == 0 {
		return ""
	}
	b, err := json.Marshal(sources)
	if err != nil {
		return ""
	}
	return string(b)
}

func unmarshalYouTubeSources(raw string) []PersonalAgentYouTubeSource {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var out []PersonalAgentYouTubeSource
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil
	}
	return out
}

func hashToRecord(vals map[string]string) PersonalAgentRecord {
	port := 0
	if v := strings.TrimSpace(vals["service_port"]); v != "" {
		fmt.Sscanf(v, "%d", &port)
	}
	return PersonalAgentRecord{
		ID:                vals["id"],
		OwnerEmail:        vals["owner_email"],
		OwnerSlackUserID:  vals["owner_slack_user_id"],
		DisplayName:       vals["display_name"],
		Description:       vals["description"],
		LongDescription:   vals["long_description"],
		Visibility:        vals["visibility"],
		ShowIntelligence:  hashToBool(vals["show_intelligence"]),
		SystemPrompt:      vals["system_prompt"],
		SlackAppID:        vals["slack_app_id"],
		SlackClientID:     vals["slack_client_id"],
		SlackClientSecret: vals["slack_client_secret"],
		SlackSigningSecret: vals["slack_signing_secret"],
		OAuthAuthorizeURL: vals["oauth_authorize_url"],
		ServiceNamespace:  vals["service_namespace"],
		ServiceName:       vals["service_name"],
		ServicePort:       port,
		BotUserID:         vals["bot_user_id"],
		YouTubeSources:    unmarshalYouTubeSources(vals["youtube_sources"]),
		KnowledgeToken:    vals["knowledge_token"],
		Status:            vals["status"],
		CreatedAt:         vals["created_at"],
		UpdatedAt:         vals["updated_at"],
	}
}

// EnsurePersonalAgentKnowledgeToken returns the existing per-agent bearer
// token, minting a fresh one on first call. The token is what the in-cluster
// personal-agent pod uses to authenticate against /v1/personal-agents/knowledge
// (see #607). Idempotent: callers can invoke at provision OR lazily on read
// without worrying about double-minting — the index write is a no-op when the
// record already has a token.
//
// The returned token is also written to a by-token index for O(1) auth lookup.
func (s *Store) EnsurePersonalAgentKnowledgeToken(ctx context.Context, agentID string) (string, error) {
	rec, err := s.GetPersonalAgent(ctx, agentID)
	if err != nil {
		return "", err
	}
	if token := strings.TrimSpace(rec.KnowledgeToken); token != "" {
		// Index may be missing for older records minted before the index landed;
		// re-set defensively. SET is idempotent.
		if err := s.rdb.Set(ctx, personalAgentByKnowledgeTokenRedisKey(token), agentID, 0).Err(); err != nil {
			return "", fmt.Errorf("backfill knowledge token index: %w", err)
		}
		return token, nil
	}
	token, err := mintPersonalAgentKnowledgeToken()
	if err != nil {
		return "", err
	}
	pipe := s.rdb.TxPipeline()
	pipe.HSet(ctx, personalAgentRedisKey(agentID), map[string]any{
		"knowledge_token": token,
		"updated_at":      time.Now().UTC().Format(time.RFC3339),
	})
	pipe.Set(ctx, personalAgentByKnowledgeTokenRedisKey(token), agentID, 0)
	if _, err := pipe.Exec(ctx); err != nil {
		return "", fmt.Errorf("persist knowledge token: %w", err)
	}
	return token, nil
}

// GetPersonalAgentByKnowledgeToken is the auth lookup for the lazy-load
// knowledge endpoint. Returns redis.Nil when the token doesn't index any
// agent — caller maps that to 401 (don't leak which agent would have matched).
func (s *Store) GetPersonalAgentByKnowledgeToken(ctx context.Context, token string) (PersonalAgentRecord, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return PersonalAgentRecord{}, redis.Nil
	}
	id, err := s.rdb.Get(ctx, personalAgentByKnowledgeTokenRedisKey(token)).Result()
	if err != nil {
		return PersonalAgentRecord{}, err
	}
	return s.GetPersonalAgent(ctx, id)
}

// mintPersonalAgentKnowledgeToken returns a fresh 32-hex-char bearer. The
// `pak_` prefix (personal agent knowledge) makes it grep-able in logs without
// being secret-revealing on its own.
func mintPersonalAgentKnowledgeToken() (string, error) {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", fmt.Errorf("mint knowledge token: %w", err)
	}
	return "pak_" + hex.EncodeToString(buf[:]), nil
}

// ListPersonalAgents returns every personal-agent record. It SCANs the main
// record keyspace (makeacompany:personal_agent:<id>) — the by-owner / by-app
// index keys have distinct prefixes (personal_agent_by_owner:, _by_app:) and
// do NOT match this glob, so no filtering is needed. Used by the manifest
// backfill. Records that vanish mid-scan are skipped, not fatal.
func (s *Store) ListPersonalAgents(ctx context.Context) ([]PersonalAgentRecord, error) {
	var out []PersonalAgentRecord
	var cursor uint64
	pattern := personalAgentKeyPrefix + "*"
	for {
		keys, next, err := s.rdb.Scan(ctx, cursor, pattern, 200).Result()
		if err != nil {
			return nil, fmt.Errorf("scan personal agents: %w", err)
		}
		for _, key := range keys {
			id := strings.TrimPrefix(key, personalAgentKeyPrefix)
			rec, err := s.GetPersonalAgent(ctx, id)
			if err != nil {
				// redis.Nil (deleted between scan and read) or a malformed
				// entry — skip, don't abort the whole listing.
				continue
			}
			out = append(out, rec)
		}
		if next == 0 {
			break
		}
		cursor = next
	}
	return out, nil
}
