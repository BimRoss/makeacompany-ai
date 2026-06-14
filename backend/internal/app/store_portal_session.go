package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const portalSessionKeyPrefix = keyPrefix + ":portal_session:"

func portalSessionKey(token string) string {
	return portalSessionKeyPrefix + strings.TrimSpace(token)
}

// PortalSession is a browser session in the portal.
//
// Two tenant types share this storage:
//   - "company": keyed by (email, channelId). Granted by /<channelId>/login
//     flows; ChannelID required.
//   - "user": keyed by email alone. Granted by /me/login flows; ChannelID
//     must be empty.
//
// tenant_type used to also include a "personal" sibling for the
// now-removed personal-agents track; that variant is gone. Existing rows
// written before tenant_type shipped read as "company" via the default
// in GetPortalSession (they always had a non-empty channel_id).
const (
	PortalTenantTypeCompany = "company"
	PortalTenantTypeUser    = "user"
)

type PortalSession struct {
	Token      string `json:"token"`
	Email      string `json:"email"`
	ChannelID  string `json:"channelId"`
	TenantType string `json:"tenantType"`
	CreatedAt  string `json:"createdAt"`
	ExpiresAt  string `json:"expiresAt"`
}

func (s *Store) CreatePortalSession(ctx context.Context, token, email, channelID, tenantType string, expiresAt time.Time) error {
	token = strings.TrimSpace(token)
	email = normalizeProfileEmail(email)
	channelID = strings.TrimSpace(channelID)
	tenantType = strings.TrimSpace(tenantType)
	if tenantType == "" {
		tenantType = PortalTenantTypeCompany
	}
	if token == "" || email == "" {
		return fmt.Errorf("missing portal session token/email")
	}
	switch tenantType {
	case PortalTenantTypeCompany:
		if channelID == "" {
			return fmt.Errorf("company portal session missing channel")
		}
	case PortalTenantTypeUser:
		if channelID != "" {
			return fmt.Errorf("user portal session must not carry channel")
		}
	default:
		return fmt.Errorf("unknown portal tenant_type %q", tenantType)
	}
	if expiresAt.IsZero() {
		return fmt.Errorf("missing portal session expiration")
	}
	ttl := time.Until(expiresAt)
	if ttl <= 0 {
		return fmt.Errorf("portal session already expired")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	key := portalSessionKey(token)
	pipe := s.rdb.TxPipeline()
	pipe.HSet(ctx, key, map[string]any{
		"email":       email,
		"channel_id":  channelID,
		"tenant_type": tenantType,
		"createdAt":   now,
		"expiresAt":   expiresAt.UTC().Format(time.RFC3339),
	})
	pipe.Expire(ctx, key, ttl)
	_, err := pipe.Exec(ctx)
	if err != nil {
		_ = s.rdb.Del(ctx, key).Err()
		return err
	}
	return nil
}

func (s *Store) GetPortalSession(ctx context.Context, token string) (PortalSession, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return PortalSession{}, fmt.Errorf("missing portal session token")
	}
	key := portalSessionKey(token)
	vals, err := s.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return PortalSession{}, err
	}
	if len(vals) == 0 {
		return PortalSession{}, redis.Nil
	}
	out := PortalSession{
		Token:      token,
		Email:      normalizeProfileEmail(vals["email"]),
		ChannelID:  strings.TrimSpace(vals["channel_id"]),
		TenantType: strings.TrimSpace(vals["tenant_type"]),
		CreatedAt:  strings.TrimSpace(vals["createdAt"]),
		ExpiresAt:  strings.TrimSpace(vals["expiresAt"]),
	}
	if out.TenantType == "" {
		// Back-compat: rows written before tenant_type shipped are company
		// scope. They always had a non-empty channel_id, so the company
		// validation below still applies.
		out.TenantType = PortalTenantTypeCompany
	}
	if out.Email == "" {
		return PortalSession{}, redis.Nil
	}
	switch out.TenantType {
	case PortalTenantTypeCompany:
		if out.ChannelID == "" {
			return PortalSession{}, redis.Nil
		}
	case PortalTenantTypeUser:
		if out.ChannelID != "" {
			return PortalSession{}, redis.Nil
		}
	default:
		return PortalSession{}, redis.Nil
	}
	gone, err := s.repairPortalSessionTTLIfNeeded(ctx, key, out.ExpiresAt)
	if err != nil {
		return PortalSession{}, err
	}
	if gone {
		return PortalSession{}, redis.Nil
	}
	return out, nil
}

func (s *Store) repairPortalSessionTTLIfNeeded(ctx context.Context, key, expiresAtRFC3339 string) (gone bool, err error) {
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

func (s *Store) DeletePortalSession(ctx context.Context, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}
	return s.rdb.Del(ctx, portalSessionKey(token)).Err()
}

