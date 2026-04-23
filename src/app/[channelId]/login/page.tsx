import type { Metadata } from "next";
import { Suspense } from "react";

import { SignInCard, SignInMethodStack } from "@/components/auth/sign-in-card";
import { SignInUnauthorizedToast } from "@/components/auth/sign-in-unauthorized-toast";
import { PortalEmailMagicForm } from "@/components/portal/portal-email-magic-form";
import { PortalGoogleSignIn } from "@/components/portal/portal-google-sign-in";
import { PortalLoginRedirectWhenSessionValid } from "@/components/portal/portal-login-redirect-when-session-valid";
import { PortalLoginMessages } from "@/components/portal/portal-login-messages";
import { getPortalLoginCompanyLabel } from "@/lib/portal/portal-login-channel-label";

type Props = {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { channelId } = await params;
  const { label } = await getPortalLoginCompanyLabel(channelId ?? "");
  return {
    title: `${label} Company Portal — Login`,
    robots: { index: false, follow: false },
  };
}

export default async function CompanyChannelLoginPage({ params, searchParams }: Props) {
  const { channelId } = await params;
  await searchParams;
  const id = decodeURIComponent((channelId ?? "").trim());
  const { label } = await getPortalLoginCompanyLabel(channelId ?? "");

  const googleOAuthReady = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() && process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
  );
  const magicEmailReady = Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.PORTAL_AUTH_EMAIL_FROM?.trim(),
  );

  return (
    <>
      <PortalLoginRedirectWhenSessionValid channelId={id} />
      <SignInUnauthorizedToast message="You aren't allowed to access this company with that account. Use the same email as a channel owner in Slack." />
      <SignInCard
      title={`${label} company portal`}
      titleClassName="capitalize"
      headingProps={{ title: `Slack channel id: ${id}` }}
      description="Sign in to open your company workspace—channel context, updates, and shared knowledge in one place."
      messages={
        <Suspense fallback={null}>
          <PortalLoginMessages />
        </Suspense>
      }
      signIn={
        <SignInMethodStack
          googleOAuthReady={googleOAuthReady}
          magicEmailReady={magicEmailReady}
          googleSlot={<PortalGoogleSignIn channelId={id} />}
          emailSlot={<PortalEmailMagicForm channelId={id} />}
          unconfiguredMessage="Add Google OAuth and Resend email env vars to enable sign-in for this portal."
        />
      }
    />
    </>
  );
}
