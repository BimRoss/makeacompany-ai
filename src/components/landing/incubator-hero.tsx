import Image from "next/image";
import { ArrowRight } from "lucide-react";

import { IncubatorHeroHeadline } from "@/components/landing/incubator-hero-headline";

const CONTACT_EMAIL = "john@makeacompany.ai";
const CONTACT_BCC = "grant@makeacompany.ai";
const CONTACT_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Multiply with MaC",
)}&bcc=${CONTACT_BCC}`;

/**
 * Incubator-positioning hero. The headline types out on first visit (see
 * IncubatorHeroHeadline), then the single black CTA points at the front door.
 * Headline + button copy are locked with John (2026-06-30).
 */
export function IncubatorHero() {
  return (
    <section
      id="start"
      className="relative flex w-full flex-col items-center justify-start px-4 pb-8 pt-12 sm:px-6 sm:pb-12 sm:pt-16 lg:pb-16 lg:pt-20"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-4xl text-center">
        <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground sm:mb-6">
          By introduction only
        </p>

        <IncubatorHeroHeadline
          text="Multiply yourself. Your best work, in a fraction of the time and cost."
          className="mx-auto mb-5 max-w-3xl text-balance text-[1.75rem] font-bold leading-[1.1] tracking-tight text-foreground sm:mb-6 sm:text-5xl sm:leading-[1.06] lg:text-6xl"
        />

        <p className="mx-auto mb-8 max-w-xl text-pretty text-base text-muted-foreground sm:mb-10 sm:text-lg">
          The builders&apos; incubator. For founders and operators chasing
          maximum leverage on their money, time, and focus. We build alongside a
          small portfolio of companies, with{" "}
          <a
            href="https://www.brandlete.com"
            target="_blank"
            rel="noopener"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Brandlete, Inc.
          </a>{" "}
          as the flagship.
        </p>

        <div className="mx-auto flex w-full max-w-sm justify-center">
          <a
            href={CONTACT_HREF}
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 sm:h-14 sm:w-auto sm:px-10 sm:text-lg"
          >
            Multiply with MaC
            <ArrowRight
              className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 sm:h-5 sm:w-5"
              aria-hidden
            />
          </a>
        </div>

        <p className="mx-auto mt-3 max-w-xl text-balance text-xs text-muted-foreground sm:mt-3.5 sm:text-sm">
          By introduction. Our team reviews every request.
        </p>

        <div className="mx-auto mt-10 w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-black sm:mt-14">
          <Image
            src="/incubator/hero.png"
            alt="One glowing cube multiplied into six, one operator multiplied into the output of a team"
            width={1376}
            height={768}
            priority
            className="h-auto w-full"
            sizes="(max-width: 768px) 100vw, 768px"
          />
        </div>
      </div>
    </section>
  );
}
