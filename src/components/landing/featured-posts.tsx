import type { FeaturedPost } from "@/lib/featured-posts";

export function FeaturedPosts({ posts }: { posts: FeaturedPost[] }) {
  if (posts.length === 0) return null;

  return (
    <section className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            From the field
          </p>
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
            What the platform shipped this week
          </h2>
          <p className="text-lg text-muted-foreground">
            Long-form posts and partner pitches rendered through MaC. Same operator, different surfaces.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {posts.map((post) => {
            const host = new URL(post.url).host;
            return (
              <a
                key={post.slug}
                href={post.url}
                target="_blank"
                rel="noopener"
                aria-label={`${post.title} — ${post.cta}`}
                style={{ backgroundColor: post.bg, color: post.fg }}
                className="group/post flex flex-col rounded-xl border border-black/5 p-6 sm:p-8 shadow-sm transition-all duration-300 ease-out will-change-transform hover:-translate-y-1.5 hover:scale-[1.015] hover:shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25"
              >
                <p
                  className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: post.accent }}
                >
                  {post.eyebrow}
                </p>
                <h3 className="mb-3 text-xl sm:text-2xl font-bold leading-tight tracking-tight">
                  {post.title}
                </h3>
                <p
                  className="mb-6 text-[15px] sm:text-base leading-relaxed"
                  style={{ color: post.mutedFg }}
                >
                  {post.dek}
                </p>
                <div className="mt-auto flex flex-col gap-3">
                  <div
                    className="flex items-center justify-between text-xs font-mono"
                    style={{ color: post.mutedFg }}
                  >
                    <span>{post.authors}</span>
                    <time dateTime={post.publishedAt}>{post.publishedAt}</time>
                  </div>
                  <span
                    style={{ borderColor: post.accent, color: post.accent }}
                    className="inline-flex w-fit items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold whitespace-nowrap transition-all duration-300 ease-out group-hover/post:gap-2.5"
                  >
                    {post.cta}
                    <span aria-hidden>→</span>
                  </span>
                  <span
                    className="truncate text-xs font-mono"
                    style={{ color: post.mutedFg }}
                  >
                    {host}
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
