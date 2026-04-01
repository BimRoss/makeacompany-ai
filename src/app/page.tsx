import { CheckoutCTA } from "@/components/checkout-cta";
import { SiteHeader } from "@/components/site-header";
import { siteDescription, siteTitle } from "@/lib/site";

export default function HomePage() {
  return (
    <div className="hero-grid min-h-dvh">
      <SiteHeader />
      <main className="mx-auto flex max-w-3xl flex-col px-4 pb-24 pt-24 sm:px-6 sm:pt-32">
        <p className="mb-3 text-center text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
          BimRoss · company as code
        </p>
        <h1 className="font-display text-center text-4xl font-bold leading-tight tracking-tight text-[var(--foreground)] sm:text-5xl md:text-6xl">
          {siteTitle}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-center text-base text-[var(--muted-foreground)] sm:text-lg">
          {siteDescription}
        </p>

        <section className="mt-14 flex flex-col items-center gap-10 sm:mt-20">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[0_24px_80px_-40px_rgba(0,0,0,0.35)]">
            <div className="aspect-video w-full bg-[var(--secondary)]">
              <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-[var(--muted-foreground)]">
                Product preview GIF — placeholder for v1
              </div>
            </div>
          </div>
          <CheckoutCTA />
        </section>

        <footer className="mt-24 border-t border-[var(--border)] pt-8 text-center text-xs text-[var(--muted-foreground)] sm:text-sm">
          <p>One human. Infinite agents. Readable state. Proof over promises.</p>
        </footer>
      </main>
    </div>
  );
}
