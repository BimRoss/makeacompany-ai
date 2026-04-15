export type CompanyChannel = {
  company_slug: string;
  channel_id: string;
  display_name?: string;
  /** Slack user IDs allowed as human operators for this channel (required for operator behavior once the channel is in the registry). */
  owner_ids?: string[];
  threads_enabled: boolean;
  general_auto_reaction_enabled: boolean;
  /** When omitted on older rows, treat as false in UI. */
  out_of_office_enabled?: boolean;
  passive_banter_enabled?: boolean;
  /** Cadence in seconds when passive banter is on: 10, 30, 60, 300, or 600. */
  passive_banter_interval_seconds?: number;
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
