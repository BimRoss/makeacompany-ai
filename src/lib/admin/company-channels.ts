export type CompanyChannel = {
  company_slug: string;
  channel_id: string;
  display_name?: string;
  /** Slack user IDs allowed as human operators for this channel; empty → runtime uses CEO id. */
  owner_ids?: string[];
  threads_enabled: boolean;
  general_auto_reaction_enabled: boolean;
};

export type CompanyChannelsResponse = {
  channels: CompanyChannel[];
  truncated: boolean;
  redisKey?: string;
};

/** Human-facing channel label for admin (e.g. `#bimross` from company slug). */
export function channelDisplayTitle(ch: CompanyChannel): string {
  const slug = ch.company_slug?.trim();
  if (slug) return `#${slug.toLowerCase()}`;
  const dn = ch.display_name?.trim();
  if (dn) return dn;
  return ch.channel_id;
}
