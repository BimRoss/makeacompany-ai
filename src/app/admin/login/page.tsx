import type { Metadata } from "next";
import { Suspense } from "react";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { AdminAuthenticateButton } from "@/components/admin/admin-authenticate-button";
import { AdminLoginMessages } from "@/components/admin/admin-login-messages";

export const metadata: Metadata = {
  title: "Admin sign in",
  description: "Authenticate with Stripe to access the admin dashboard",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-6 px-4 py-16 sm:py-24">
        <Suspense fallback={null}>
          <AdminLoginMessages />
        </Suspense>
        <AdminAuthenticateButton />
      </div>
      <Footer />
    </main>
  );
}
