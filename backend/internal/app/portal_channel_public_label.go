package app

import (
	"errors"
	"net/http"
	"strings"
	"unicode"
)

// portalDisplayLabelFromCompanyChannel matches makeacompany-ai
// src/lib/admin/company-channels.ts companyPortalDisplayName (slug title-case, then display_name, then id).
func portalDisplayLabelFromCompanyChannel(e CompanyChannel) string {
	slug := strings.TrimSpace(e.CompanySlug)
	if slug != "" {
		parts := strings.FieldsFunc(slug, func(r rune) bool {
			return r == '-' || r == '_'
		})
		var b strings.Builder
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			if b.Len() > 0 {
				b.WriteByte(' ')
			}
			low := strings.ToLower(p)
			runes := []rune(low)
			if len(runes) > 0 {
				runes[0] = unicode.ToUpper(runes[0])
				b.WriteString(string(runes))
			}
		}
		if b.Len() > 0 {
			return b.String()
		}
	}
	dn := strings.TrimSpace(e.DisplayName)
	for strings.HasPrefix(dn, "#") {
		dn = strings.TrimSpace(strings.TrimPrefix(dn, "#"))
	}
	if dn != "" {
		return dn
	}
	return strings.TrimSpace(e.ChannelID)
}

// handlePortalChannelPublicLabel serves GET /v1/portal/channel-public-label/{channelId} with no auth.
// Used by the company portal login page (SSR) to show a human-readable title from the shared Redis registry.
func (s *Server) handlePortalChannelPublicLabel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	chID := strings.TrimSpace(r.PathValue("channelId"))
	if chID == "" || !ValidSlackChannelID(chID) {
		http.Error(w, "bad channel id", http.StatusBadRequest)
		return
	}
	label := chID
	if s.store != nil {
		e, err := s.store.GetCompanyChannel(r.Context(), s.cfg.CompanyChannelsRedisKey, chID)
		if err == nil {
			label = portalDisplayLabelFromCompanyChannel(e)
		} else if !errors.Is(err, ErrCompanyChannelNotFound) {
			s.log.Printf("portal channel public label: redis get channel=%s err=%v", chID, err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"channel_id": chID,
		"label":      label,
	})
}
