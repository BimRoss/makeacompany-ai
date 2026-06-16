package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	personalAgentKeyPrefix      = keyPrefix + ":personal_agent:"
	personalAgentByOwnerPrefix  = keyPrefix + ":personal_agent_by_owner:"
	personalAgentByAppIDPrefix  = keyPrefix + ":personal_agent_by_app:"

	PersonalAgentStatusPendingInstall = "pending_install"
	PersonalAgentStatusInstalled      = "installed"
	PersonalAgentStatusFailed         = "failed"
)

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
	Status           string `json:"status"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
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
func (s *Store) UpdatePersonalAgentDisplay(ctx context.Context, agentID, displayName, description string) error {
	fields := map[string]any{"updated_at": time.Now().UTC().Format(time.RFC3339)}
	if v := strings.TrimSpace(displayName); v != "" {
		fields["display_name"] = v
	}
	if v := strings.TrimSpace(description); v != "" {
		fields["description"] = v
	}
	return s.updatePersonalAgentFields(ctx, agentID, fields)
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
		"slack_app_id":        r.SlackAppID,
		"slack_client_id":     r.SlackClientID,
		"slack_client_secret": r.SlackClientSecret,
		"slack_signing_secret": r.SlackSigningSecret,
		"oauth_authorize_url": r.OAuthAuthorizeURL,
		"service_namespace":   r.ServiceNamespace,
		"service_name":        r.ServiceName,
		"service_port":        r.ServicePort,
		"bot_user_id":         r.BotUserID,
		"status":              r.Status,
		"created_at":          r.CreatedAt,
		"updated_at":          r.UpdatedAt,
	}
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
		SlackAppID:        vals["slack_app_id"],
		SlackClientID:     vals["slack_client_id"],
		SlackClientSecret: vals["slack_client_secret"],
		SlackSigningSecret: vals["slack_signing_secret"],
		OAuthAuthorizeURL: vals["oauth_authorize_url"],
		ServiceNamespace:  vals["service_namespace"],
		ServiceName:       vals["service_name"],
		ServicePort:       port,
		BotUserID:         vals["bot_user_id"],
		Status:            vals["status"],
		CreatedAt:         vals["created_at"],
		UpdatedAt:         vals["updated_at"],
	}
}
