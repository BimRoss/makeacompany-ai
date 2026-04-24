import type { Metadata } from "next";
import { Suspense } from "react";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { AdminEmailMagicForm } from "@/components/admin/admin-email-magic-form";
import { AdminGoogleSignIn } from "@/components/admin/admin-google-sign-in";
import { AdminLoginRedirectWhenSessionValid } from "@/components/admin/admin-login-redirect-when-session-valid";
import { AdminLoginMessages } from "@/components/admin/admin-login-messages";
import { SignInCard, SignInMethodStack } from "@/components/auth/sign-in-card";
import { SignInUnauthorizedToast } from "@/components/auth/sign-in-unauthorized-toast";

export const dynamic = "force-dynamic";

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

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <Header />
      <AdminLoginRedirectWhenSessionValid />
      <SignInUnauthorizedToast message="That account isn't allowed for admin access." />
      <SignInCard
        title="Admin dashboard"
        description={
          <>
            Welcome to the admin dashboard. Only one person is allowed in here, and you know who you are. Good luck
            otherwise!
          </>
        }
        messages={
          <Suspense fallback={null}>
            <AdminLoginMessages />
          </Suspense>
        }
        signIn={
          <SignInMethodStack
            googleOAuthReady={googleOAuthReady}
            magicEmailReady={magicEmailReady}
            googleSlot={<AdminGoogleSignIn />}
            emailSlot={<AdminEmailMagicForm />}
            unconfiguredMessage="Configure Google OAuth and Resend email env vars to enable admin sign-in."
          />
        }
      />
      <Footer />
    </main>
  );
}
