import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { PortalLogoutButton } from "@/components/portal/portal-logout-button";
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
    <main className="flex min-h-screen flex-col bg-background">
      <Header endSlot={<PortalLogoutButton channelId={id} />} />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-3 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
        {children}
      </div>
      <Footer />
    </main>
  );
}
