import { resolveBackendBaseURL } from "@/lib/resolve-backend-base-url";

export type LanderTestimonial = {
  id: string;
  name: string;
  role: string;
  content: string;
  avatar: string;
  avatarImage?: string;
};

/**
 * Static fallback used when the backend is unreachable (SSG, network blip, cold
 * boot before seed). Mirrors the six entries we seed into Redis on first boot,
 * so the page renders the same content in either path.
 */
export const FALLBACK_TESTIMONIALS: LanderTestimonial[] = [
  {
    id: "sarah_chen",
    name: "Sarah Chen",
    role: "Founder, TechFlow",
    avatar: "SC",
    content:
      "We replaced 3 part-time VAs with makeacompany.ai. It's like having a team that never sleeps and actually follows instructions.",
  },
  {
    id: "marcus_johnson",
    name: "Marcus Johnson",
    role: "CEO, DataScale",
    avatar: "MJ",
    content:
      "We went from zero to a working support queue in one afternoon—agents handle most tickets; we only step in on edge cases.",
  },
  {
    id: "emily_rodriguez",
    name: "Emily Rodriguez",
    role: "Head of Ops, Velocity",
    avatar: "ER",
    content:
      "The ROI is real—we cut what we’d have paid contractors for the same throughput, and quality went up because nothing slips.",
  },
  {
    id: "david_park",
    name: "David Park",
    role: "Solo Founder",
    avatar: "DP",
    content:
      "As a solo founder, this gave me a team. I finally have someone to delegate to. Game changer for indie hackers.",
  },
  {
    id: "alex_thompson",
    name: "Alex Thompson",
    role: "VP Engineering, CloudBase",
    avatar: "AT",
    content:
      "Slack-native was non-negotiable for us—the handoff feels like @mentioning a teammate, not opening another tool.",
  },
  {
    id: "grant_foster",
    name: "Grant Foster",
    role: "Founder, BimRoss",
    avatar: "GF",
    avatarImage: "/grant-headshot.png",
    content:
      "Well, I'm the founder... and I couldn't exist without it... literally. I can never tell if I'm working on the company or the product, but regardless, it's helped me scale my company to... well, this.",
  },
];

type BackendTestimonial = {
  id?: string;
  name?: string;
  role?: string;
  content?: string;
  avatar?: string;
  avatarImage?: string;
  status?: string;
};

/**
 * Server-side fetch for the testimonials carousel. Hits the public
 * `/v1/lander/testimonials` endpoint. On any failure returns the static
 * fallback list — the lander must never render empty.
 */
export async function fetchLanderTestimonials(): Promise<LanderTestimonial[]> {
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/lander/testimonials`;
  try {
    const res = await fetch(url, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return FALLBACK_TESTIMONIALS;
    const body = (await res.json()) as { testimonials?: BackendTestimonial[] };
    const rows = Array.isArray(body.testimonials) ? body.testimonials : [];
    const cleaned: LanderTestimonial[] = rows
      .filter((t) => t && t.id && t.name && t.role && t.content)
      .map((t) => ({
        id: String(t.id),
        name: String(t.name),
        role: String(t.role),
        content: String(t.content),
        avatar: String(t.avatar ?? ""),
        avatarImage: t.avatarImage ? String(t.avatarImage) : undefined,
      }));
    return cleaned.length > 0 ? cleaned : FALLBACK_TESTIMONIALS;
  } catch {
    return FALLBACK_TESTIMONIALS;
  }
}
