import { Suspense } from "react";

import { SignInCard, SignInMethodStack } from "@/components/auth/sign-in-card";
import { MeEmailMagicForm } from "@/components/me/me-email-magic-form";
import { MeGoogleSignIn } from "@/components/me/me-google-sign-in";
import { MeLoginMessages } from "@/components/me/me-login-messages";
import { MeLoginRedirectWhenSessionValid } from "@/components/me/me-login-redirect-when-session-valid";
import { MeSlackSignIn } from "@/components/me/me-slack-sign-in";

// Force dynamic rendering so process.env.* env-gate checks read the running
// pod's secrets rather than the (empty) build container's env. Without this,
// Next prerenders /me/login as static HTML at build time and the page bakes in
// the "unconfigured" state regardless of what's set in prod.
export const dynamic = "force-dynamic";

export default function MeLoginPage() {
  const googleOAuthReady = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() && process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
  );
  const magicEmailReady = Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.PORTAL_AUTH_EMAIL_FROM?.trim(),
  );
  const slackOAuthReady = Boolean(
    process.env.SLACK_OAUTH_CLIENT_ID?.trim() && process.env.SLACK_OAUTH_CLIENT_SECRET?.trim(),
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
            slackOAuthReady={slackOAuthReady}
            googleSlot={<MeGoogleSignIn />}
            emailSlot={<MeEmailMagicForm />}
            slackSlot={<MeSlackSignIn />}
            unconfiguredMessage="Add Google OAuth, Slack OAuth, or Resend email env vars to enable account sign-in."
          />
        }
      />
    </>
  );
}
