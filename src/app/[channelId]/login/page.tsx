import type { Metadata } from "next";
import { Suspense } from "react";

import { PortalAuthenticateButton } from "@/components/portal/portal-authenticate-button";
import { PortalLoginMessages } from "@/components/portal/portal-login-messages";
import { getPortalLoginCompanyLabel } from "@/lib/portal/portal-login-channel-label";

type Props = {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstQuery(v: string | string[] | undefined): string {
  if (typeof v === "string") {
    return v.trim();
  }
  if (Array.isArray(v) && typeof v[0] === "string") {
    return v[0].trim();
  }
  return "";
}

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
  const sp = await searchParams;
  const id = decodeURIComponent((channelId ?? "").trim());
  const stripeCustomerId =
    firstQuery(sp.stripe_customer) || firstQuery(sp["stripeCustomerId"]);
  const { label } = await getPortalLoginCompanyLabel(channelId ?? "");

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
          <PortalAuthenticateButton channelId={id} stripeCustomerId={stripeCustomerId || undefined} />
        </div>
      </div>
    </div>
  );
}
