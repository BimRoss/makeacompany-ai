import { Sparkles } from "lucide-react";
import { CheckoutButton } from "@/components/landing/checkout-button";
import { HeroJoanneInviteCard } from "@/components/landing/hero-joanne-invite-card";
import { HeroMobileVideoCarousel } from "@/components/landing/hero-mobile-video-carousel";
import { TaoSlackSignalBadges } from "@/components/landing/tao-slack-signal-badges";
import { siteDescriptionLine2, siteTaglineLine1, siteTaglineLine2 } from "@/lib/site";

export function HeroSection() {
  return (
    <section className="relative flex w-full min-h-0 flex-col items-center justify-start px-4 pb-4 pt-4 sm:min-h-screen sm:justify-center sm:px-6 sm:pb-14 sm:pt-16">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-6xl text-center">
        <div className="mb-4 flex justify-center sm:mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-foreground bg-background px-3 py-1.5 text-xs text-foreground sm:px-4 sm:py-2 sm:text-sm">
            <Sparkles className="h-3.5 w-3.5 text-foreground sm:h-4 sm:w-4" />
            <span>Unlimited AI teams for $9/mo</span>
          </div>
        </div>

        <h1 className="mb-3 text-4xl font-bold leading-[1.08] tracking-tight text-foreground sm:mb-4 sm:text-5xl sm:leading-[1.06] md:text-6xl lg:text-7xl">
          <span className="block sm:whitespace-nowrap">{siteTaglineLine1}</span>
          <span className="block sm:whitespace-nowrap">{siteTaglineLine2}</span>
        </h1>

        <div className="mb-5 flex w-full justify-center sm:mb-6">
          <TaoSlackSignalBadges />
        </div>

        <p className="mx-auto mb-4 w-full max-w-4xl text-pretty text-center text-lg font-medium leading-relaxed text-muted-foreground sm:mb-8 sm:text-xl md:whitespace-nowrap md:text-2xl">
          {siteDescriptionLine2}
        </p>

        <div className="mb-3 flex justify-center sm:mb-4">
          <p className="inline-flex items-center rounded-full border border-border bg-muted px-4 py-1.5 text-sm font-semibold tracking-tight text-foreground sm:px-5 sm:text-base">
            $9/mo · unlimited AI teams
          </p>
        </div>

        <CheckoutButton label="Start Building" />

        <HeroJoanneInviteCard />
      </div>

      <div className="relative mx-auto mt-12 w-full min-w-0 max-w-5xl px-0 sm:mt-16 sm:px-0">
        <div className="relative z-10 -mx-3 w-[calc(100%+1.5rem)] min-w-0 scale-[0.97] sm:hidden">
          <HeroMobileVideoCarousel />
        </div>

        <div className="hero-stack-motion relative z-10 hidden w-full min-w-0 origin-center scale-[0.93] transition-[transform,box-shadow] hover:z-40 hover:-translate-y-1.5 hover:scale-[1.01] hover:shadow-[0_42px_90px_-34px_rgba(0,0,0,0.62)] sm:block">
          <div className="overflow-hidden rounded-xl border border-border/40 bg-card shadow-2xl">
            <div className="relative w-full bg-muted/20">
              <video
                src="/hero-desktop.mp4"
                muted
                playsInline
                loop
                autoPlay
                preload="auto"
                className="block h-auto w-full object-cover object-top"
                aria-label="AI employees working in Slack — desktop demo"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/20 to-transparent" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
