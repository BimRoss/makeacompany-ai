export type CompanyChannel = {
  company_slug: string;
  channel_id: string;
  display_name?: string;
  /** Slack user IDs allowed as human operators for this channel (required for operator behavior once the channel is in the registry). */
  owner_ids?: string[];
  threads_enabled: boolean;
  general_auto_reaction_enabled: boolean;
  /** When true, plain-channel thumbs + random thread reply are off. Omitted/false = General on (default). */
  general_responses_muted?: boolean;
  /** When omitted on older rows, treat as false in UI. */
  out_of_office_enabled?: boolean;
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

/**
 * Portal login / headings: prefer Slack channel display name, then a title-cased company slug,
 * then the raw channel id.
 */
export function companyPortalDisplayName(ch: CompanyChannel): string {
  const dn = ch.display_name?.trim();
  if (dn) return dn;
  const slug = ch.company_slug?.trim();
  if (slug) {
    const parts = slug.split(/[-_]+/).filter(Boolean);
    if (parts.length > 0) {
      return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
    }
  }
  return ch.channel_id?.trim() ?? "";
}
