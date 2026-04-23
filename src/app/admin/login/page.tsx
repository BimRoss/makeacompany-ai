import type { Metadata } from "next";
import { Suspense } from "react";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { AdminEmailMagicForm } from "@/components/admin/admin-email-magic-form";
import { AdminGoogleSignIn } from "@/components/admin/admin-google-sign-in";
import { AdminLoginMessages } from "@/components/admin/admin-login-messages";

export const metadata: Metadata = {
  title: "Admin sign in",
  description: "Sign in with Google or email to access the admin dashboard",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  const googleOAuthReady = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() && process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
  );
  const magicEmailReady = Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.PORTAL_AUTH_EMAIL_FROM?.trim(),
  );
  const showPrimarySignIn = googleOAuthReady || magicEmailReady;

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-8 px-4 py-16 sm:py-24">
        <div className="w-full max-w-md space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Admin dashboard</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Sign in with the same Google or email flow as the company portal. Only allowlisted accounts can access
            admin.
          </p>
        </div>
        <Suspense fallback={null}>
          <AdminLoginMessages />
        </Suspense>
        {showPrimarySignIn ? (
          <div className="flex w-full flex-col items-center gap-4">
            {googleOAuthReady ? <AdminGoogleSignIn /> : null}
            {magicEmailReady ? <AdminEmailMagicForm /> : null}
          </div>
        ) : (
          <p className="max-w-md rounded-lg border border-border bg-muted/25 px-4 py-3 text-center text-sm text-muted-foreground">
            Configure Google OAuth and Resend email env vars to enable admin sign-in.
          </p>
        )}
      </div>
      <Footer />
    </main>
  );
}
