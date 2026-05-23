import { CheckCircle } from "lucide-react";
import { EmailCaptureForm } from "@/components/landing/email-capture-form";

export function CtaSection() {
  return (
    <section className="py-20">
      <div className="mx-auto w-full max-w-4xl px-6">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-8 shadow-lg sm:p-12">
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />

          <div className="relative w-full text-center">
            <h2 className="mb-4 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              Ready to build?
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-pretty text-lg text-muted-foreground">
              Enter your email below and try the product for free!
            </p>
            <div className="mb-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-foreground" />
                <span>Free</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-foreground" />
                <span>AI employees in Slack</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-foreground" />
                <span>Upgrade anytime</span>
              </div>
            </div>
            <EmailCaptureForm />
            <p className="mt-6 text-pretty text-sm text-muted-foreground">
              Built by{" "}
              <a
                href="https://bimross.com"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                BimRoss
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
