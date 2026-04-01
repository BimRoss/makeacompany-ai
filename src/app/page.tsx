import { CountdownTimer } from "@/components/landing/countdown-timer";
import { CheckoutReturnToast } from "@/components/landing/checkout-return-toast";
import { CtaSection } from "@/components/landing/cta-section";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { HeroSection } from "@/components/landing/hero-section";
import { TestimonialsCarousel } from "@/components/landing/testimonials-carousel";
import { WaitlistProgress } from "@/components/landing/waitlist-progress";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background">
      <CheckoutReturnToast />
      <Header />
      <HeroSection />
      <CountdownTimer />
      <WaitlistProgress />
      <TestimonialsCarousel />
      <CtaSection />
      <Footer />
    </main>
  );
}
