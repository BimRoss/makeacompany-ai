import { ArrowRight } from "lucide-react";

const CONTACT_EMAIL = "john@makeacompany.ai";
const CONTACT_BCC = "grant@makeacompany.ai";
const CONTACT_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Multiply with MaC",
)}&bcc=${CONTACT_BCC}`;

/**
 * Closing CTA for the incubator lander. Inbound-only: the one action is an
 * introduction to John. No pricing, no self-serve signup.
 */
export function IncubatorCta() {
  return (
    <section className="py-10 sm:py-14">
      <div className="mx-auto w-full max-w-4xl px-6">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-8 text-center shadow-lg sm:p-12">
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />

          <div className="relative w-full">
            <h2 className="mb-4 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              Think you belong here?
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-pretty text-lg text-muted-foreground">
              We take on a small number of founders and operators at a time. If
              you want to build with real leverage, start with an introduction.
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

            <p className="mt-6 text-pretty text-sm text-muted-foreground">
              The MaC team reviews every request.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
