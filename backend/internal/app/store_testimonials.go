package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	testimonialKeyPrefix = keyPrefix + ":testimonial:v1:"
	testimonialIndexKey  = keyPrefix + ":testimonials:v1:index"
)

// MaxTestimonialContent caps the quote body. Short enough that a 4-line clamp
// at the carousel's card width has no visible cutoff for typical entries.
const MaxTestimonialContent = 240

// MaxTestimonialRole caps the "Title, Company" string. 80 chars fits the
// card's single-line subtitle without truncation at the smallest card width.
const MaxTestimonialRole = 80

// ErrTestimonialNotFound is returned when no testimonial exists for the given id.
var ErrTestimonialNotFound = errors.New("testimonial not found")

// Testimonial is one entry on the public testimonials carousel. `Avatar` is the
// initials fallback rendered when `AvatarImage` is empty.
type Testimonial struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	Content     string `json:"content"`
	Avatar      string `json:"avatar"`
	AvatarImage string `json:"avatarImage,omitempty"`
	Status      string `json:"status"`
	Source      string `json:"source,omitempty"`
	SourceRef   string `json:"sourceRef,omitempty"`
	CapturedBy  string `json:"capturedBy,omitempty"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

func testimonialKey(id string) string { return testimonialKeyPrefix + id }

var testimonialSlugRe = regexp.MustCompile(`[^a-z0-9]+`)

// NormalizeTestimonialID produces a stable, URL-safe slug. Returns "" if the
// input is empty after trimming.
func NormalizeTestimonialID(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	s = testimonialSlugRe.ReplaceAllString(s, "_")
	s = strings.Trim(s, "_")
	if len(s) > 80 {
		s = s[:80]
	}
	return s
}

// ValidateTestimonial returns an error if a required field is missing or a
// length cap is exceeded. Trims string fields in place and normalizes role +
// content so the public carousel renders a uniform set.
func ValidateTestimonial(t *Testimonial) error {
	t.Name = strings.TrimSpace(t.Name)
	t.Role = NormalizeTestimonialRole(t.Role)
	t.Content = NormalizeTestimonialContent(t.Content)
	t.Avatar = strings.TrimSpace(t.Avatar)
	t.AvatarImage = strings.TrimSpace(t.AvatarImage)
	t.Status = strings.TrimSpace(t.Status)
	t.Source = strings.TrimSpace(t.Source)
	t.SourceRef = strings.TrimSpace(t.SourceRef)
	t.CapturedBy = strings.TrimSpace(t.CapturedBy)
	if t.Name == "" {
		return fmt.Errorf("name is required")
	}
	if t.Role == "" {
		return fmt.Errorf("role is required")
	}
	if strings.ContainsAny(t.Role, "\r\n") {
		return fmt.Errorf("role must not contain newlines")
	}
	if len(t.Role) > MaxTestimonialRole {
		return fmt.Errorf("role exceeds %d chars", MaxTestimonialRole)
	}
	if t.Content == "" {
		return fmt.Errorf("content is required")
	}
	if len(t.Content) > MaxTestimonialContent {
		return fmt.Errorf("content exceeds %d chars", MaxTestimonialContent)
	}
	switch t.Status {
	case "":
		t.Status = "published"
	case "published", "draft", "hidden":
	default:
		return fmt.Errorf("status must be published|draft|hidden")
	}
	if t.Avatar == "" {
		t.Avatar = deriveInitials(t.Name)
	}
	return nil
}

// NormalizeTestimonialRole collapses whitespace, splits on commas, and
// uppercases the first letter of each segment so we get a uniform
// "Title, Company" shape regardless of how the capturer typed it.
func NormalizeTestimonialRole(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		// Uppercase the first rune only; preserve casing of the rest so brand
		// names like "BimRoss" or acronyms like "CTO" survive intact.
		r := []rune(p)
		r[0] = []rune(strings.ToUpper(string(r[0])))[0]
		out = append(out, string(r))
	}
	return strings.Join(out, ", ")
}

// NormalizeTestimonialContent trims whitespace and strips a matched pair of
// outer quote characters (straight or curly) so cards can wrap the body in
// their own typographic quotes without double-quoting.
func NormalizeTestimonialContent(raw string) string {
	s := strings.TrimSpace(raw)
	if len([]rune(s)) < 2 {
		return s
	}
	pairs := [][2]string{
		{"\"", "\""},
		{"'", "'"},
		{"“", "”"}, // “ ”
		{"‘", "’"}, // ‘ ’
	}
	for _, p := range pairs {
		if strings.HasPrefix(s, p[0]) && strings.HasSuffix(s, p[1]) {
			s = strings.TrimSpace(s[len(p[0]) : len(s)-len(p[1])])
			break
		}
	}
	return s
}

func deriveInitials(name string) string {
	parts := strings.Fields(name)
	if len(parts) == 0 {
		return ""
	}
	out := strings.ToUpper(string(parts[0][0]))
	if len(parts) > 1 {
		out += strings.ToUpper(string(parts[len(parts)-1][0]))
	}
	return out
}

// SaveTestimonial upserts a testimonial. The score in the sorted-set index is
// the unix-nano of CreatedAt so newest-first ordering is stable across writes.
func (s *Store) SaveTestimonial(ctx context.Context, t Testimonial) (Testimonial, error) {
	if err := ValidateTestimonial(&t); err != nil {
		return Testimonial{}, err
	}
	if t.ID == "" {
		t.ID = NormalizeTestimonialID(t.Name + "_" + time.Now().UTC().Format("2006_01_02_150405"))
	} else {
		t.ID = NormalizeTestimonialID(t.ID)
	}
	if t.ID == "" {
		return Testimonial{}, fmt.Errorf("could not derive id")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)

	existingBlob, err := s.rdb.Get(ctx, testimonialKey(t.ID)).Bytes()
	if err != nil && !errors.Is(err, redis.Nil) {
		return Testimonial{}, err
	}
	if len(existingBlob) > 0 {
		var prior Testimonial
		if err := json.Unmarshal(existingBlob, &prior); err == nil {
			if t.CreatedAt == "" {
				t.CreatedAt = prior.CreatedAt
			}
		}
	}
	if t.CreatedAt == "" {
		t.CreatedAt = now
	}
	t.UpdatedAt = now

	blob, err := json.Marshal(t)
	if err != nil {
		return Testimonial{}, err
	}

	score := unixNanoScore(t.CreatedAt)
	pipe := s.rdb.TxPipeline()
	pipe.Set(ctx, testimonialKey(t.ID), blob, 0)
	pipe.ZAdd(ctx, testimonialIndexKey, redis.Z{Score: score, Member: t.ID})
	if _, err := pipe.Exec(ctx); err != nil {
		return Testimonial{}, err
	}
	return t, nil
}

func unixNanoScore(rfc3339 string) float64 {
	if ts, err := time.Parse(time.RFC3339Nano, rfc3339); err == nil {
		return float64(ts.UnixNano())
	}
	if ts, err := time.Parse(time.RFC3339, rfc3339); err == nil {
		return float64(ts.UnixNano())
	}
	return float64(time.Now().UnixNano())
}

// GetTestimonial loads a single testimonial by id.
func (s *Store) GetTestimonial(ctx context.Context, id string) (Testimonial, error) {
	id = NormalizeTestimonialID(id)
	if id == "" {
		return Testimonial{}, ErrTestimonialNotFound
	}
	blob, err := s.rdb.Get(ctx, testimonialKey(id)).Bytes()
	if errors.Is(err, redis.Nil) {
		return Testimonial{}, ErrTestimonialNotFound
	}
	if err != nil {
		return Testimonial{}, err
	}
	var t Testimonial
	if err := json.Unmarshal(blob, &t); err != nil {
		return Testimonial{}, err
	}
	return t, nil
}

// DeleteTestimonial removes the record and its index entry. Returns
// ErrTestimonialNotFound if the id was not in the index.
func (s *Store) DeleteTestimonial(ctx context.Context, id string) error {
	id = NormalizeTestimonialID(id)
	if id == "" {
		return ErrTestimonialNotFound
	}
	removed, err := s.rdb.ZRem(ctx, testimonialIndexKey, id).Result()
	if err != nil {
		return err
	}
	if err := s.rdb.Del(ctx, testimonialKey(id)).Err(); err != nil {
		return err
	}
	if removed == 0 {
		return ErrTestimonialNotFound
	}
	return nil
}

// ListTestimonials returns testimonials newest-first. If publishedOnly is true,
// `status != "published"` entries are filtered out.
func (s *Store) ListTestimonials(ctx context.Context, publishedOnly bool) ([]Testimonial, error) {
	ids, err := s.rdb.ZRevRange(ctx, testimonialIndexKey, 0, -1).Result()
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []Testimonial{}, nil
	}
	keys := make([]string, len(ids))
	for i, id := range ids {
		keys[i] = testimonialKey(id)
	}
	blobs, err := s.rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}
	out := make([]Testimonial, 0, len(blobs))
	for _, raw := range blobs {
		s, ok := raw.(string)
		if !ok || s == "" {
			continue
		}
		var t Testimonial
		if err := json.Unmarshal([]byte(s), &t); err != nil {
			continue
		}
		if publishedOnly && t.Status != "published" {
			continue
		}
		out = append(out, t)
	}
	return out, nil
}

// TestimonialsIndexEmpty reports whether the sorted-set index has zero entries.
// Used at boot to decide whether to seed the initial six.
func (s *Store) TestimonialsIndexEmpty(ctx context.Context) (bool, error) {
	n, err := s.rdb.ZCard(ctx, testimonialIndexKey).Result()
	if err != nil {
		return false, err
	}
	return n == 0, nil
}
