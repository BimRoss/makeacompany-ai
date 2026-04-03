import Image from "next/image";
import { Sparkles } from "lucide-react";
import { CheckoutButton } from "@/components/landing/checkout-button";
import { MobileHeroCardStack } from "@/components/landing/mobile-hero-card-stack";
import { TaoSlackSignalBadges } from "@/components/landing/tao-slack-signal-badges";
import { siteDescription, siteTagline } from "@/lib/site";

export function HeroSection() {
  return (
    <section className="relative flex min-h-0 flex-col items-center justify-start px-4 pb-4 pt-4 sm:min-h-screen sm:justify-center sm:px-6 sm:pb-14 sm:pt-16">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-foreground bg-background px-3 py-1.5 text-xs text-foreground sm:mb-8 sm:px-4 sm:py-2 sm:text-sm">
          <Sparkles className="h-3.5 w-3.5 text-foreground sm:h-4 sm:w-4" />
          <span>First 100 users get a FREE month on launch</span>
        </div>

        <h1 className="mb-3 text-balance text-3xl font-bold tracking-tight text-foreground sm:mb-4 sm:text-5xl md:text-6xl lg:text-7xl">
          {siteTagline}
        </h1>

        <p className="mx-auto mb-6 max-w-xl text-pretty text-lg font-medium leading-relaxed text-muted-foreground sm:mb-8 sm:max-w-2xl sm:text-xl md:text-2xl">
          {siteDescription}
        </p>

        <div className="mb-5 flex w-full justify-center sm:mb-6">
          <TaoSlackSignalBadges />
        </div>

        <p className="mx-auto mb-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:mb-8 sm:max-w-2xl sm:text-xl">
          <span className="sm:hidden">
            For solo founders and lean teams: AI &quot;employees&quot; that execute 24/7—without another payroll line.
          </span>
          <span className="hidden sm:inline">
            For solo founders and lean teams who need leverage, not headcount: an AI-powered company
            inside Slack—roles that ship around the clock without another payroll line.
          </span>
        </p>

        <div className="mb-5 text-sm text-muted-foreground sm:mb-10">
          <p className="sm:hidden">Create, define roles, and deploy to Slack instantly.</p>
          <div className="hidden items-center justify-center gap-2.5 sm:flex sm:flex-row sm:flex-wrap sm:gap-x-8 sm:gap-y-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 shrink-0 rounded-full bg-foreground" aria-hidden />
              <span className="text-black dark:text-white">Chat to create your company</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 shrink-0 rounded-full bg-foreground" aria-hidden />
              <span className="text-black dark:text-white">Define roles & personalities</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 shrink-0 rounded-full bg-foreground" aria-hidden />
              <span className="text-black dark:text-white">Deploy to Slack instantly</span>
            </div>
          </div>
        </div>

        <p className="mx-auto mb-3 inline-flex items-center rounded-full border border-border bg-muted px-4 py-1.5 text-sm font-semibold tracking-tight text-foreground sm:mb-4 sm:px-5 sm:text-base">
          Make a company for $1
        </p>

        <CheckoutButton label="Join the Waitlist" />

        <div className="mt-3 space-y-1.5 text-xs text-muted-foreground sm:mt-4 sm:text-sm">
          <p>$1 reservation—fully refundable anytime before launch.</p>
          <p className="hidden text-pretty text-muted-foreground/90 sm:block">
            It holds your spot in the first 100 and keeps the waitlist for people who actually show up.
          </p>
        </div>
      </div>

      <div className="relative mt-6 w-full max-w-5xl px-4 sm:mt-16 sm:px-4">
        {/* Narrow viewports: stacked phone mockups (no desktop screenshot). */}
        <div className="sm:hidden">
          <MobileHeroCardStack />
        </div>

        {/* sm+: desktop Slack screenshot with phone overlapping the left. */}
        <div className="relative hidden isolate sm:block">
          <div className="hero-stack-motion peer/desktop relative z-10 origin-center scale-[0.93] hover:z-40 hover:-translate-y-1.5 hover:scale-[1.01] hover:shadow-[0_42px_90px_-34px_rgba(0,0,0,0.62)]">
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

          <div
            className="hero-stack-motion absolute -left-3 top-1/2 z-30 w-[min(38%,260px)] -translate-y-1/2 peer-hover/desktop:z-10 peer-hover/desktop:translate-x-2 peer-hover/desktop:translate-y-[calc(-50%+10px)] peer-hover/desktop:scale-[0.97] peer-hover/desktop:opacity-95 md:-left-2 md:w-[min(36%,300px)] lg:w-[min(32%,320px)]"
            role="group"
            aria-label="Mobile Slack examples"
          >
            <MobileHeroCardStack
              className="max-w-none px-3 pb-5 pt-4"
              imageSizes="(max-width: 1024px) 260px, 320px"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
