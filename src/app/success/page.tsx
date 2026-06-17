import type { Metadata } from "next";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { SuccessOnboardingCard } from "@/components/landing/success-onboarding-card";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<{ session_id?: string }>;
};

export default async function SuccessPage({ searchParams }: Props) {
  const params = await searchParams;
  const sessionID = (params.session_id ?? "").trim();

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <Header />
      <section className="relative px-6 py-16 sm:py-24">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-0 h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
        </div>
        <div className="relative mx-auto w-full max-w-5xl">
          <SuccessOnboardingCard sessionID={sessionID} />
        </div>
      </section>
      <Footer />
    </main>
  );
}
