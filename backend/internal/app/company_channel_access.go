package app

import (
	"net/http"
)

// authorizedForCompanyChannelRead allows internal service token (existing admin proxies) or a valid portal session for channelID.
func (s *Server) authorizedForCompanyChannelRead(r *http.Request, channelID string) bool {
	if s.companyChannelsAdminAuthorized(r) {
		return true
	}
	if _, err := s.validatePortalSessionForChannel(r.Context(), tokenFromAuthHeader(r), channelID); err == nil {
		return true
	}
	return false
}

// authorizedForCompanyChannelPatch allows internal service token or a portal session scoped to the same channelID.
func (s *Server) authorizedForCompanyChannelPatch(r *http.Request, channelID string) bool {
	if s.companyChannelsAdminAuthorized(r) {
		return true
	}
	if _, err := s.validatePortalSessionForChannel(r.Context(), tokenFromAuthHeader(r), channelID); err == nil {
		return true
	}
	return false
}
