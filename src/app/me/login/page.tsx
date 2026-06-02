import type { Metadata } from "next";

import { SignInCard } from "@/components/auth/sign-in-card";
import { PortalPersonalGoogleSignIn } from "@/components/portal/portal-personal-google-sign-in";

// /me/login — personal-scope (cid-less) sign-in for the /me dashboard
// (#199). Currently Google-only; magic-link variant is a follow-up.
// Once authenticated, the auth callback drops the user at /me/agents.

export const metadata: Metadata = {
  title: "Sign in · makeacompany.ai",
  robots: { index: false, follow: false },
};

export default function MeLoginPage() {
  const googleOAuthReady = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() && process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
  );

  return (
    <SignInCard
      title="Sign in to your account"
      description="Personal agents and per-user settings live here. Use the same email you use elsewhere in the workspace."
      messages={null}
      signIn={
        googleOAuthReady ? (
          <PortalPersonalGoogleSignIn />
        ) : (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-300">
            Sign-in is not configured for this workspace yet. An operator needs to set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.
          </p>
        )
      }
    />
  );
}
