import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { PortalHeaderLogoutSlot } from "@/components/portal/portal-header-logout-slot";
import { validSlackChannelId } from "@/lib/slack-channel-id";

type Props = { children: ReactNode; params: Promise<{ channelId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { channelId } = await params;
  const id = decodeURIComponent((channelId ?? "").trim());
  return {
    title: validSlackChannelId(id) ? `Company ${id}` : "Company",
    robots: { index: false, follow: false },
  };
}

export default async function CompanyChannelLayout({ children, params }: Props) {
  const { channelId } = await params;
  const id = decodeURIComponent((channelId ?? "").trim());
  if (!validSlackChannelId(id)) {
    notFound();
  }
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <Header endSlot={<PortalHeaderLogoutSlot channelId={id} />} />
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-3 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
      <Footer />
    </main>
  );
}
