import { CompanyChannelWorkspaceDetail } from "@/components/company-channel/company-channel-workspace-detail";

type Props = {
  params: Promise<{ channelId: string }>;
};

export default async function CompanyChannelPage({ params }: Props) {
  const { channelId } = await params;
  const id = decodeURIComponent((channelId ?? "").trim());
  return <CompanyChannelWorkspaceDetail channelId={id} variant="portal" />;
}
