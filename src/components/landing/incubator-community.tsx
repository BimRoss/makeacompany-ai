/**
 * "You're building among founders" — the community play. The undervalued piece
 * is the room itself: founders helping each other, often just by being seen.
 * Watching each other use AI up-skills everyone, so direction gets sharper
 * across the whole group. Copy from John (2026-07-02). Brand voice: no em
 * dashes, no inflated vocab, monochrome with a black pull-quote for weight.
 */
export function IncubatorCommunity() {
  return (
    <section id="community" className="py-14 sm:py-20">
      <div className="mx-auto w-full max-w-4xl px-6 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          The part nobody prices in
        </p>
        <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          You&apos;re building among founders.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-muted-foreground">
          The most undervalued piece of MaC is the room itself. Founders in the
          same space, helping each other, often just by being seen. Every time
          one operator does something new with AI where others can watch, the
          skill spreads without anyone teaching a class. You get sharper by
          watching. So does everyone around you.
        </p>

        <blockquote className="mx-auto mt-10 max-w-3xl rounded-2xl bg-foreground px-6 py-10 sm:px-10">
          <p className="text-balance text-xl font-semibold leading-snug tracking-tight text-background sm:text-2xl">
            Alone, you learn at your own pace. In the room, you learn at
            everyone else&apos;s, at lightspeed.
          </p>
        </blockquote>
      </div>
    </section>
  );
}
