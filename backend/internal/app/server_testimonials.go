package app

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

// handleLanderTestimonials returns published testimonials, newest-first, for
// the public landing page carousel. Unauthenticated.
func (s *Server) handleLanderTestimonials(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	list, err := s.store.ListTestimonials(r.Context(), true)
	if err != nil {
		s.log.Printf("lander testimonials list: %v", err)
		writeJSON(w, http.StatusOK, map[string]any{"testimonials": []Testimonial{}})
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=60, s-maxage=60")
	writeJSON(w, http.StatusOK, map[string]any{"testimonials": list})
}

// handleAdminTestimonials routes /v1/admin/testimonials and
// /v1/admin/testimonials/{id} based on method + path suffix. Reuses the same
// admin/internal-service auth as the other admin endpoints.
func (s *Server) handleAdminTestimonials(w http.ResponseWriter, r *http.Request) {
	ok, svcUnavail := s.adminReadOrInternalServiceAuthorized(r)
	if !ok {
		if svcUnavail {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		} else {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/v1/admin/testimonials")
	id = strings.Trim(id, "/")

	if id == "reorder" && r.Method == http.MethodPost {
		s.serveAdminTestimonialReorder(w, r)
		return
	}

	switch r.Method {
	case http.MethodGet:
		if id != "" {
			s.serveAdminTestimonialGet(w, r, id)
			return
		}
		list, err := s.store.ListTestimonials(r.Context(), false)
		if err != nil {
			s.log.Printf("admin testimonials list: %v", err)
			http.Error(w, "list error", http.StatusInternalServerError)
			return
		}
		writeJSONNoStore(w, http.StatusOK, map[string]any{"testimonials": list})
	case http.MethodPost, http.MethodPut:
		s.serveAdminTestimonialUpsert(w, r, id)
	case http.MethodDelete:
		if id == "" {
			http.Error(w, "missing id", http.StatusBadRequest)
			return
		}
		if err := s.store.DeleteTestimonial(r.Context(), id); err != nil {
			if errors.Is(err, ErrTestimonialNotFound) {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			s.log.Printf("admin testimonial delete: %v", err)
			http.Error(w, "delete error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": NormalizeTestimonialID(id)})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) serveAdminTestimonialGet(w http.ResponseWriter, r *http.Request, id string) {
	t, err := s.store.GetTestimonial(r.Context(), id)
	if err != nil {
		if errors.Is(err, ErrTestimonialNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		s.log.Printf("admin testimonial get: %v", err)
		http.Error(w, "get error", http.StatusInternalServerError)
		return
	}
	writeJSONNoStore(w, http.StatusOK, t)
}

func (s *Server) serveAdminTestimonialUpsert(w http.ResponseWriter, r *http.Request, pathID string) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16*1024))
	if err != nil {
		http.Error(w, "body too large or unreadable", http.StatusBadRequest)
		return
	}
	var t Testimonial
	if len(body) > 0 {
		if err := json.Unmarshal(body, &t); err != nil {
			http.Error(w, "bad json: "+err.Error(), http.StatusBadRequest)
			return
		}
	}
	if pathID != "" {
		t.ID = pathID
	}
	saved, err := s.store.SaveTestimonial(r.Context(), t)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

// serveAdminTestimonialReorder handles POST /v1/admin/testimonials/reorder.
// Body: {"ids": ["id1", "id2", ...]} — position 0 is shown first in the carousel.
// Bypasses content-length validation so it works for records that pre-date the
// 240-char limit.
func (s *Server) serveAdminTestimonialReorder(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16*1024))
	if err != nil {
		http.Error(w, "body too large or unreadable", http.StatusBadRequest)
		return
	}
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "bad json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if len(req.IDs) == 0 {
		http.Error(w, "ids is required", http.StatusBadRequest)
		return
	}
	if err := s.store.SetTestimonialSortOrders(r.Context(), req.IDs); err != nil {
		s.log.Printf("testimonial reorder: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": len(req.IDs)})
}
