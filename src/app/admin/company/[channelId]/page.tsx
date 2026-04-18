import { AdminShell } from "@/components/admin/admin-shell";
import { AdminCompanyChannelDetail } from "@/components/admin/admin-company-channel-detail";

type Props = {
  params: Promise<{ channelId: string }>;
};

export default async function AdminCompanyChannelPage({ params }: Props) {
  const { channelId } = await params;
  const id = decodeURIComponent((channelId ?? "").trim());
  return (
    <AdminShell>
      <AdminCompanyChannelDetail channelId={id} />
    </AdminShell>
  );
}
