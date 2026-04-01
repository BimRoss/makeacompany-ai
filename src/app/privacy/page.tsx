import type { Metadata } from "next";
import { Footer } from "@/components/landing/footer";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy practices for makeacompany.ai.",
  alternates: {
    canonical: "/privacy",
  },
  openGraph: {
    title: "Privacy Policy",
    description: "Privacy practices for makeacompany.ai.",
    url: `${siteUrl}/privacy`,
  },
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-20">
        <p className="text-sm uppercase tracking-[0.16em] text-muted-foreground">Legal</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Privacy Policy</h1>
        <p className="mt-4 text-sm text-muted-foreground">Effective date: April 1, 2026</p>

        <div className="mt-10 space-y-8 text-base leading-7 text-foreground/90">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">What we collect</h2>
            <p>
              We collect information you provide directly, such as your name, email address, and any message
              you submit through waitlist or contact forms. We may also collect basic technical information like
              device type, browser, and usage events needed to operate and improve the website.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">How we use information</h2>
            <p>
              We use information to run the site, respond to inquiries, manage waitlist communications, improve
              product quality, and protect the platform from abuse. We may also use aggregated analytics to
              understand website performance.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Sharing and processors</h2>
            <p>
              We may share data with trusted service providers that help us host, analyze, communicate, and
              operate our services. We do not sell personal information. We may disclose information when
              required by law or to protect rights, safety, and security.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Cookies and analytics</h2>
            <p>
              We may use cookies and similar technologies to maintain session behavior, measure traffic, and
              improve user experience. You can adjust browser settings to control cookies, though some features
              may not function correctly.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Data retention and security</h2>
            <p>
              We retain information only as long as needed for legitimate business or legal purposes. We use
              reasonable safeguards designed to protect data, but no method of transmission or storage is
              completely secure.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Your choices</h2>
            <p>
              You may request access, correction, deletion, or export of your personal information, subject to
              applicable law. You can also opt out of non-essential marketing messages using unsubscribe links
              where provided.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Children</h2>
            <p>
              This website is not directed to children under 13, and we do not knowingly collect personal
              information from children under 13.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Policy updates</h2>
            <p>
              We may update this policy from time to time. Material changes will be posted on this page with an
              updated effective date.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Contact</h2>
            <p>
              For privacy questions, email{" "}
              <a href="mailto:hello@makeacompany.ai" className="underline underline-offset-4">
                hello@makeacompany.ai
              </a>
              .
            </p>
          </section>
        </div>
      </section>
      <Footer />
    </main>
  );
}
