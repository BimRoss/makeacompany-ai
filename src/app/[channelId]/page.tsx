import { CompanyChannelPortalDetail } from "@/components/portal/company-channel-portal-detail";
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
      <CompanyChannelPortalDetail channelId={id} />
    </>
  );
}
