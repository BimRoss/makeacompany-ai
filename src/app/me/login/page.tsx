import { Suspense } from "react";

import { SignInCard, SignInMethodStack } from "@/components/auth/sign-in-card";
import { MeEmailMagicForm } from "@/components/me/me-email-magic-form";
import { MeGoogleSignIn } from "@/components/me/me-google-sign-in";
import { MeLoginMessages } from "@/components/me/me-login-messages";
import { MeLoginRedirectWhenSessionValid } from "@/components/me/me-login-redirect-when-session-valid";

export default function MeLoginPage() {
  const googleOAuthReady = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() && process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
  );
  const magicEmailReady = Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.PORTAL_AUTH_EMAIL_FROM?.trim(),
  );

  return (
    <>
      <MeLoginRedirectWhenSessionValid />
      <SignInCard
        title="Your MakeaCompany account"
        description="Sign in to view your subscription and personal agents."
        messages={
          <Suspense fallback={null}>
            <MeLoginMessages />
          </Suspense>
        }
        signIn={
          <SignInMethodStack
            googleOAuthReady={googleOAuthReady}
            magicEmailReady={magicEmailReady}
            googleSlot={<MeGoogleSignIn />}
            emailSlot={<MeEmailMagicForm />}
            unconfiguredMessage="Add Google OAuth and Resend email env vars to enable account sign-in."
          />
        }
      />
    </>
  );
}
