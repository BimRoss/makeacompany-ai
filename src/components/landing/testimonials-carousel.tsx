import { Star } from "lucide-react";

const TESTIMONIALS = [
  {
    id: 1,
    name: "Sarah Chen",
    role: "Founder, TechFlow",
    avatar: "SC",
    content:
      "We replaced 3 part-time VAs with makeacompany.ai. It's like having a team that never sleeps and actually follows instructions.",
  },
  {
    id: 2,
    name: "Marcus Johnson",
    role: "CEO, DataScale",
    avatar: "MJ",
    content:
      "We went from zero to a working support queue in one afternoon—agents handle most tickets; we only step in on edge cases.",
  },
  {
    id: 3,
    name: "Emily Rodriguez",
    role: "Head of Ops, Velocity",
    avatar: "ER",
    content:
      "The ROI is real—we cut what we’d have paid contractors for the same throughput, and quality went up because nothing slips.",
  },
  {
    id: 4,
    name: "David Park",
    role: "Solo Founder",
    avatar: "DP",
    content:
      "As a solo founder, this gave me a team. I finally have someone to delegate to. Game changer for indie hackers.",
  },
  {
    id: 5,
    name: "Alex Thompson",
    role: "VP Engineering, CloudBase",
    avatar: "AT",
    content:
      "Slack-native was non-negotiable for us—the handoff feels like @mentioning a teammate, not opening another tool.",
  },
  {
    id: 6,
    name: "Jennifer Wu",
    role: "COO, GrowthLabs",
    avatar: "JW",
    content:
      "We created specialized agents for sales, support, and ops. Each one has their own personality and expertise.",
  },
];

export function TestimonialsCarousel() {
  return (
    <section className="bg-muted/30 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Early users are already seeing results
          </h2>
          <p className="text-lg text-muted-foreground">
            Here&apos;s what beta testers are saying about makeacompany.ai
          </p>
        </div>

        <div className="scrollbar-thin -mx-2 flex snap-x snap-mandatory gap-4 overflow-x-auto px-2 pb-2">
          {TESTIMONIALS.map((testimonial) => (
            <article
              key={testimonial.id}
              className="min-w-[84%] snap-start rounded-xl border border-border bg-card p-6 shadow-sm sm:min-w-[48%] lg:min-w-[31%]"
            >
              <div className="mb-4 flex gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-foreground text-foreground" />
                ))}
              </div>
              <p className="mb-6 text-pretty text-muted-foreground">&quot;{testimonial.content}&quot;</p>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-sm font-semibold">
                  {testimonial.avatar}
                </div>
                <div>
                  <p className="font-semibold">{testimonial.name}</p>
                  <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
