import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ channelId: string }>;
};

/** Legacy URL; channel detail lives under `/admin/[channelId]`. */
export default async function OrchestratorChannelRedirect({ params }: Props) {
  const { channelId } = await params;
  redirect(`/admin/${encodeURIComponent(channelId)}`);
}
