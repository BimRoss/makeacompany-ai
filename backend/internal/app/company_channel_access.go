package app

import (
	"net/http"
)

// authorizedForCompanyChannelRead allows either:
// - a valid admin session, or
// - a valid portal session scoped to channelID.
func (s *Server) authorizedForCompanyChannelRead(r *http.Request, channelID string) bool {
	if s.companyChannelsAdminAuthorized(r) {
		return true
	}
	if _, err := s.validatePortalSessionForChannel(r.Context(), tokenFromAuthHeader(r), channelID); err == nil {
		return true
	}
	return false
}

// authorizedForCompanyChannelPatch allows either:
// - a valid admin session, or
// - a valid portal session scoped to channelID.
func (s *Server) authorizedForCompanyChannelPatch(r *http.Request, channelID string) bool {
	if s.companyChannelsAdminAuthorized(r) {
		return true
	}
	if _, err := s.validatePortalSessionForChannel(r.Context(), tokenFromAuthHeader(r), channelID); err == nil {
		return true
	}
	return false
}
