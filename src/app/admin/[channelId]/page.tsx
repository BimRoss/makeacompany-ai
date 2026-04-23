import { AdminShell } from "@/components/admin/admin-shell";
import { CompanyChannelWorkspaceDetail } from "@/components/company-channel/company-channel-workspace-detail";

type Props = {
  params: Promise<{ channelId: string }>;
};

export default async function AdminCompanyChannelPage({ params }: Props) {
  const { channelId } = await params;
  const id = decodeURIComponent((channelId ?? "").trim());
  return (
    <AdminShell>
      <CompanyChannelWorkspaceDetail channelId={id} variant="admin" />
    </AdminShell>
  );
}
