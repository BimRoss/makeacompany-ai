import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ channelId: string }>;
};

export default async function AdminChannelLegacyRedirect({ params }: Props) {
  await params;
  redirect("/admin");
}
