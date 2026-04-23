import { CompanyChannelWorkspaceDetail } from "@/components/company-channel/company-channel-workspace-detail";
import { PortalPostAuthWelcomeToast } from "@/components/portal/portal-post-auth-welcome-toast";

type Props = {
  params: Promise<{ channelId: string }>;
};

export default async function CompanyChannelPage({ params }: Props) {
  const { channelId } = await params;
  const id = decodeURIComponent((channelId ?? "").trim());
  return (
    <>
      <PortalPostAuthWelcomeToast />
      <CompanyChannelWorkspaceDetail
        channelId={id}
        variant="portal"
        backNav={{ href: "/", label: "← Home" }}
      />
    </>
  );
}
