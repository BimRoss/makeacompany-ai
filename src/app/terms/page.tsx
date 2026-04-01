import type { Metadata } from "next";
import { Footer } from "@/components/landing/footer";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "Terms of use for makeacompany.ai.",
  alternates: {
    canonical: "/terms",
  },
  openGraph: {
    title: "Terms of Use",
    description: "Terms of use for makeacompany.ai.",
    url: `${siteUrl}/terms`,
  },
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-20">
        <p className="text-sm uppercase tracking-[0.16em] text-muted-foreground">Legal</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Terms of Use</h1>
        <p className="mt-4 text-sm text-muted-foreground">Effective date: April 1, 2026</p>

        <div className="mt-10 space-y-8 text-base leading-7 text-foreground/90">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Acceptance of terms</h2>
            <p>
              By using makeacompany.ai, you agree to these Terms of Use and any policies referenced here. If you
              do not agree, do not use the website.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Permitted use</h2>
            <p>
              You may use the website for lawful purposes only. You agree not to interfere with site operations,
              attempt unauthorized access, or use the service in a way that could harm the platform or other
              users.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Intellectual property</h2>
            <p>
              Content, branding, software, and materials on this website are owned by or licensed to
              makeacompany.ai and are protected by applicable intellectual property laws. You may not copy,
              distribute, or create derivative works without permission, except as allowed by law.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">No guarantees</h2>
            <p>
              The website and all content are provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind.
              We do not guarantee uninterrupted availability, complete accuracy, or specific outcomes from using
              the service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, makeacompany.ai and its operators are not liable for
              indirect, incidental, special, consequential, or punitive damages arising from your use of the
              website.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Third-party links</h2>
            <p>
              The website may include links to third-party sites or services. We are not responsible for their
              content, security, policies, or practices.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Changes to terms</h2>
            <p>
              We may update these terms at any time. Updated terms become effective when posted on this page.
              Continued use of the website after updates means you accept the revised terms.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Governing law</h2>
            <p>
              These terms are governed by applicable law in the jurisdiction where the site operator is based,
              without regard to conflict-of-law rules.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Contact</h2>
            <p>
              For terms-related questions, email{" "}
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
