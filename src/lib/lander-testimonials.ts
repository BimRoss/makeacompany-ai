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
 * Empty fallback. We deliberately no longer ship hardcoded testimonials —
 * if the backend is unreachable the carousel renders nothing rather than
 * fabricated quotes. The carousel returns null on an empty array.
 */
export const FALLBACK_TESTIMONIALS: LanderTestimonial[] = [];

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
 * `/v1/lander/testimonials` endpoint. On any failure returns an empty list
 * (the carousel hides itself rather than rendering placeholder quotes).
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
