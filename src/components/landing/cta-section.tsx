import { CheckoutButton } from "@/components/landing/checkout-button";
import { CheckCircle } from "lucide-react";

export function CtaSection() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-4xl px-6">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-8 shadow-lg sm:p-12">
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />

          <div className="relative text-center">
            <h2 className="mb-4 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              Don&apos;t miss your free month
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-pretty text-lg text-muted-foreground">
              Join the first 10,000 users and get your first month completely free when we launch.
              Zero risk, fully refundable deposit.
            </p>
            <div className="mb-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-foreground" />
                <span>$1 refundable deposit</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-foreground" />
                <span>Free month on launch</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-foreground" />
                <span>Priority access</span>
              </div>
            </div>
            <CheckoutButton label="Secure Your Spot Now" className="px-10" />
            <p className="mt-6 text-sm text-muted-foreground">
              Trusted by founders from Y Combinator, Techstars, and 500 Startups
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
