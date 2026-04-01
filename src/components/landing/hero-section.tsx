import Image from "next/image";
import { Sparkles } from "lucide-react";
import { CheckoutButton } from "@/components/landing/checkout-button";

export function HeroSection() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center px-6 pt-16">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl text-center">
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-foreground bg-white px-4 py-2 text-sm text-black">
          <Sparkles className="h-4 w-4 text-black" />
          <span>First 10,000 users get a FREE month on launch</span>
        </div>

        <h1 className="mb-6 text-balance text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
          Companies for everyone.
        </h1>

        <p className="mx-auto mb-8 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">
          Create an entire AI-powered company that lives in your Slack. Employees
          that never sleep, never quit, and actually get work done.
        </p>

        <div className="mb-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full border border-foreground bg-background" />
            <span>Chat to create your company</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full border border-foreground bg-background" />
            <span>Define roles & personalities</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full border border-foreground bg-background" />
            <span>Deploy to Slack instantly</span>
          </div>
        </div>

        <CheckoutButton label="Join the Waitlist" />

        <p className="mt-4 text-sm text-muted-foreground">
          $1 reservation fee, fully refundable if you change your mind
        </p>
      </div>

      <div className="relative mt-16 w-full max-w-5xl px-4">
        <div className="overflow-hidden rounded-xl border border-border/40 bg-card shadow-2xl">
          <div className="relative aspect-[16/10] w-full bg-muted/20">
            <Image
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/CleanShot%202026-04-01%20at%2002.09.24-6CNZbGNveSlnANXHSsfpupK6pZOvyS.png"
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
