import Image from "next/image";
import { Sparkles } from "lucide-react";
import { CheckoutButton } from "@/components/landing/checkout-button";

export function HeroSection() {
  return (
    <section className="relative flex min-h-0 flex-col items-center justify-start px-4 pb-4 pt-4 sm:min-h-screen sm:justify-center sm:px-6 sm:pb-14 sm:pt-16">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-foreground bg-white px-3 py-1.5 text-xs text-black sm:mb-8 sm:px-4 sm:py-2 sm:text-sm">
          <Sparkles className="h-3.5 w-3.5 text-black sm:h-4 sm:w-4" />
          <span>First 100 users get a FREE month on launch</span>
        </div>

        <h1 className="mb-4 text-balance text-3xl font-bold tracking-tight sm:mb-6 sm:text-5xl md:text-6xl lg:text-7xl">
          Companies for everyone.
        </h1>

        <p className="mx-auto mb-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:mb-8 sm:max-w-2xl sm:text-xl">
          <span className="sm:hidden">
            Build an AI-powered company in Slack with employees that execute 24/7.
          </span>
          <span className="hidden sm:inline">
            Create an AI-powered company that lives in your Slack. Employees who
            never sleep, never quit, and actually get work done.
          </span>
        </p>

        <div className="mb-5 text-sm text-muted-foreground sm:mb-10">
          <p className="sm:hidden">Create, define roles, and deploy to Slack instantly.</p>
          <div className="hidden items-center justify-center gap-2.5 sm:flex sm:flex-row sm:flex-wrap sm:gap-x-8 sm:gap-y-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full border border-foreground bg-background" />
              <span className="text-black dark:text-white">Chat to create your company</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full border border-foreground bg-background" />
              <span className="text-black dark:text-white">Define roles & personalities</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full border border-foreground bg-background" />
              <span className="text-black dark:text-white">Deploy to Slack instantly</span>
            </div>
          </div>
        </div>

        <CheckoutButton label="Join the Waitlist" />

        <p className="mt-3 text-xs text-muted-foreground sm:mt-4 sm:text-sm">
          $1 reservation fee, fully refundable if you change your mind
        </p>
      </div>

      <div className="relative mt-6 w-full max-w-5xl px-1 sm:mt-16 sm:px-4">
        <div className="overflow-hidden rounded-xl border border-border/40 bg-card shadow-2xl">
          <div className="relative aspect-[16/9] w-full bg-muted/20 sm:aspect-[16/10]">
            <Image
              src="/hero-screenshot-2026-04-01-041155.png"
              alt="AI employees working in Slack"
              fill
              sizes="(max-width: 1024px) 100vw, 1024px"
              className="object-cover object-top"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background/20 to-transparent" />
          </div>
        </div>
      </div>
    </section>
  );
}
