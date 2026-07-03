import { ArrowRight } from "lucide-react";

const CONTACT_HREF = `mailto:john@makeacompany.ai?subject=${encodeURIComponent(
  "Multiply with MaC",
)}&bcc=grant@makeacompany.ai`;

// Closing CTA band before the footer, so the page ends on the front door
// instead of trailing off after the logo strip.
export function PreviewCta() {
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto w-full max-w-2xl px-6 text-center">
        <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Ready to multiply?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-pretty text-base text-muted-foreground sm:text-lg">
          By introduction. Tell us what you&apos;re building and we&apos;ll take
          it from there.
        </p>
        <div className="mt-8 flex justify-center">
          <a
            href={CONTACT_HREF}
            className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-8 text-base font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 sm:h-14 sm:px-10 sm:text-lg"
          >
            Multiply with MaC
            <ArrowRight
              className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 sm:h-5 sm:w-5"
              aria-hidden
            />
          </a>
        </div>
      </div>
    </section>
  );
}
