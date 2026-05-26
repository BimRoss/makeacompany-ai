package app

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

// initialTestimonials mirrors the six entries that lived in the hardcoded
// frontend array. Seeded once into Redis on first boot so the public list is
// never empty, then ownership shifts to the API.
//
// Ordering: newest-first. Sarah is first visually today, so she gets the most
// recent seed timestamp. Any real captured testimonial will naturally land in
// front of these seeds.
var initialTestimonials = []Testimonial{
	{
		ID:      "sarah_chen",
		Name:    "Sarah Chen",
		Role:    "Founder, TechFlow",
		Avatar:  "SC",
		Content: "We replaced 3 part-time VAs with makeacompany.ai. It's like having a team that never sleeps and actually follows instructions.",
		Status:  "published",
		Source:  "seed",
	},
	{
		ID:      "marcus_johnson",
		Name:    "Marcus Johnson",
		Role:    "CEO, DataScale",
		Avatar:  "MJ",
		Content: "We went from zero to a working support queue in one afternoon—agents handle most tickets; we only step in on edge cases.",
		Status:  "published",
		Source:  "seed",
	},
	{
		ID:      "emily_rodriguez",
		Name:    "Emily Rodriguez",
		Role:    "Head of Ops, Velocity",
		Avatar:  "ER",
		Content: "The ROI is real—we cut what we’d have paid contractors for the same throughput, and quality went up because nothing slips.",
		Status:  "published",
		Source:  "seed",
	},
	{
		ID:      "david_park",
		Name:    "David Park",
		Role:    "Solo Founder",
		Avatar:  "DP",
		Content: "As a solo founder, this gave me a team. I finally have someone to delegate to. Game changer for indie hackers.",
		Status:  "published",
		Source:  "seed",
	},
	{
		ID:      "alex_thompson",
		Name:    "Alex Thompson",
		Role:    "VP Engineering, CloudBase",
		Avatar:  "AT",
		Content: "Slack-native was non-negotiable for us—the handoff feels like @mentioning a teammate, not opening another tool.",
		Status:  "published",
		Source:  "seed",
	},
	{
		ID:          "grant_foster",
		Name:        "Grant Foster",
		Role:        "Founder, BimRoss",
		Avatar:      "GF",
		AvatarImage: "/grant-headshot.png",
		Content:     "Well, I'm the founder... and I couldn't exist without it... literally. I can never tell if I'm working on the company or the product, but regardless, it's helped me scale my company to... well, this.",
		Status:      "published",
		Source:      "seed",
	},
}

// SeedInitialTestimonialsIfEmpty writes the initial six testimonials only when
// the sorted-set index has zero entries. Idempotent: subsequent boots no-op.
func (s *Store) SeedInitialTestimonialsIfEmpty(ctx context.Context) (seeded int, err error) {
	empty, err := s.TestimonialsIndexEmpty(ctx)
	if err != nil {
		return 0, err
	}
	if !empty {
		return 0, nil
	}
	// Stagger created_at so newest-first ordering matches the legacy array
	// (Sarah at front, Grant at the back).
	base := time.Now().UTC().Add(-time.Duration(len(initialTestimonials)) * time.Minute)
	pipe := s.rdb.TxPipeline()
	for i, t := range initialTestimonials {
		created := base.Add(time.Duration(len(initialTestimonials)-i) * time.Minute).Format(time.RFC3339Nano)
		t.CreatedAt = created
		t.UpdatedAt = created
		blob, err := json.Marshal(t)
		if err != nil {
			return 0, err
		}
		pipe.Set(ctx, testimonialKey(t.ID), blob, 0)
		pipe.ZAdd(ctx, testimonialIndexKey, redis.Z{Score: unixNanoScore(created), Member: t.ID})
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return len(initialTestimonials), nil
}
