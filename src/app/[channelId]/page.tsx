import { CompanyChannelPortalDetail } from "@/components/portal/company-channel-portal-detail";

type Props = {
  params: Promise<{ channelId: string }>;
};

export default async function CompanyChannelPage({ params }: Props) {
  const { channelId } = await params;
  const id = decodeURIComponent((channelId ?? "").trim());
  return <CompanyChannelPortalDetail channelId={id} />;
}
