import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { WorkspaceConnectPanel } from "@/components/portal/workspace-connect-panel";

type Props = {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<{ workspace_connected?: string; workspace_disconnected?: string }>;
};

export default async function CompanyChannelPage({ params, searchParams }: Props) {
  const { channelId } = await params;
  const { workspace_connected, workspace_disconnected } = await searchParams;
  const justConnected = workspace_connected === "1";
  const justDisconnected = workspace_disconnected === "1";

  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <Header />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-10 px-6 py-16 text-center">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Your company portal
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            You&apos;re signed in. Talk to Joanne or your channel agent directly in Slack.
          </p>
        </div>
        <WorkspaceConnectPanel
          channelId={channelId}
          justConnected={justConnected}
          justDisconnected={justDisconnected}
        />
      </div>
      <Footer />
    </main>
  );
}
