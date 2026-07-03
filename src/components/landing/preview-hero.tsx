import { ArrowRight } from "lucide-react";

const CONTACT_EMAIL = "john@makeacompany.ai";
const CONTACT_BCC = "grant@makeacompany.ai";
const CONTACT_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Multiply with MaC",
)}&bcc=${CONTACT_BCC}`;

/**
 * Minimal boardy-style hero for the `/preview` lander: one headline, one line
 * of subcopy, one black CTA to the front door. No graphic, no motion — the
 * point of this preview is stripped-down clarity. Headline mirrors the live
 * incubator hero so the two stay in sync.
 */
export function PreviewHero() {
  return (
    <section className="relative flex w-full flex-col items-center px-6 pb-16 pt-20 sm:pt-28 lg:pt-32">
      <div className="relative mx-auto w-full max-w-3xl text-center">
        <p className="mb-6 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          By introduction only
        </p>

        <h1 className="mx-auto mb-6 max-w-2xl text-balance text-[2rem] font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          Multiply yourself. Your best work, in a fraction of the time and cost.
        </h1>

        <p className="mx-auto mb-9 max-w-lg text-pretty text-base text-muted-foreground sm:text-lg">
          The builders&apos; incubator. One operator, the output of a whole
          team, running in Slack.
        </p>

        <div className="mx-auto flex w-full max-w-sm justify-center">
          <a
            href={CONTACT_HREF}
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-8 text-base font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 sm:h-14 sm:w-auto sm:text-lg"
          >
            Multiply with MaC
            <ArrowRight
              className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 sm:h-5 sm:w-5"
              aria-hidden
            />
          </a>
        </div>

        <p className="mx-auto mt-4 max-w-xs text-balance text-xs text-muted-foreground sm:text-sm">
          By introduction. Our team reviews every request.
        </p>
      </div>
    </section>
  );
}
