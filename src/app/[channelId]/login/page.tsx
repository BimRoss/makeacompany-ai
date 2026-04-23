import type { Metadata } from "next";
import { Suspense } from "react";

import { PortalEmailMagicForm } from "@/components/portal/portal-email-magic-form";
import { PortalGoogleSignIn } from "@/components/portal/portal-google-sign-in";
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
  const showPrimarySignIn = googleOAuthReady || magicEmailReady;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-20">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06] sm:p-10">
        <header className="mb-8 space-y-2 text-center">
          <h1
            className="text-pretty text-xl font-semibold capitalize tracking-tight text-foreground sm:text-2xl"
            title={`Slack channel id: ${id}`}
          >
            {label} company portal
          </h1>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            Sign in to open your company workspace—channel context, updates, and shared knowledge in one place.
          </p>
        </header>
        <div className="space-y-6">
          <Suspense fallback={null}>
            <PortalLoginMessages />
          </Suspense>
          {showPrimarySignIn ? (
            <div className="space-y-3">
              {googleOAuthReady ? <PortalGoogleSignIn channelId={id} /> : null}
              {magicEmailReady ? <PortalEmailMagicForm channelId={id} /> : null}
            </div>
          ) : (
            <p className="rounded-lg border border-border bg-muted/25 px-4 py-3 text-center text-sm text-muted-foreground">
              Add Google OAuth and Resend email env vars to enable sign-in for this portal.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
