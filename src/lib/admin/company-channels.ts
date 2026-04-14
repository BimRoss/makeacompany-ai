export type CompanyChannel = {
  company_slug: string;
  channel_id: string;
  display_name?: string;
  primary_owner?: string;
  allowed_operator_ids?: string[];
  threads_enabled: boolean;
  general_auto_reaction_enabled: boolean;
};

export type CompanyChannelsResponse = {
  channels: CompanyChannel[];
  truncated: boolean;
  redisKey?: string;
};
