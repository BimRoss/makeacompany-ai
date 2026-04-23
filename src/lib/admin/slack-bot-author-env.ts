import type { TeamMember } from "@/lib/admin/catalog";
import { getAdminHeadshotUrl } from "@/lib/admin/headshots";

/** Same env keys as employee-factory / rancher-admin `employee-factory-config` (Slack bot user IDs). */
const ENV_SLUG_KEYS: Array<{ envKey: string; slug: string }> = [
  { envKey: "ROSS_SLACK_BOT_ID", slug: "ross" },
  { envKey: "TIM_SLACK_BOT_ID", slug: "tim" },
  { envKey: "ALEX_SLACK_BOT_ID", slug: "alex" },
  { envKey: "GARTH_SLACK_BOT_ID", slug: "garth" },
  { envKey: "JOANNE_SLACK_BOT_ID", slug: "joanne" },
];

const DISPLAY_BY_SLUG: Record<string, string> = {
  alex: "Alex",
  tim: "Tim",
  ross: "Ross",
  garth: "Garth",
  joanne: "Joanne",
};

export type SlackBotAuthorProfile = {
  slackUserId: string;
  employeeId: string;
  displayName: string;
  portraitUrl: string;
};

function looksLikeSlackUserId(value: string): boolean {
  const t = value.trim();
  return /^U[A-Z0-9]{8,}$/i.test(t);
}

function syntheticMember(employeeId: string): TeamMember {
  const id = employeeId.trim().toLowerCase();
  const displayName = DISPLAY_BY_SLUG[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
  return {
    id,
    displayName,
    botDisplayName: displayName,
    lane: "general",
    roleTitle: "",
    shortDescription: "",
    longDescription: "",
    backgroundColor: "#334155",
    status: "active",
    sourceManifest: "env:slack-bot-id",
    skillIds: [],
  };
}

/**
 * Merge `MULTIAGENT_BOT_USER_IDS` (`ross:U0…,tim:U0…`) with per-employee `*_SLACK_BOT_ID` env vars.
 * Individual `*_SLACK_BOT_ID` values override the same employee slug from the multi-agent line.
 */
function resolveSlugToSlackUserId(): Map<string, string> {
  const m = new Map<string, string>();
  const rawMulti = process.env.MULTIAGENT_BOT_USER_IDS?.trim();
  if (rawMulti) {
    for (const part of rawMulti.split(",")) {
      const idx = part.indexOf(":");
      if (idx === -1) {
        continue;
      }
      const slug = part.slice(0, idx).trim().toLowerCase();
      const uid = part.slice(idx + 1).trim();
      if (slug && looksLikeSlackUserId(uid)) {
        m.set(slug, uid);
      }
    }
  }
  for (const { envKey, slug } of ENV_SLUG_KEYS) {
    const v = process.env[envKey]?.trim();
    if (v && looksLikeSlackUserId(v)) {
      m.set(slug, v);
    }
  }
  return m;
}

/** Profiles for admin transcript: map Slack bot user IDs → display name + `/headshots` or generated portrait URL. */
export function getSlackBotAuthorProfilesFromEnv(): SlackBotAuthorProfile[] {
  const slugMap = resolveSlugToSlackUserId();
  const out: SlackBotAuthorProfile[] = [];
  for (const [slug, slackUserId] of slugMap) {
    const member = syntheticMember(slug);
    const normalized = slackUserId.trim();
    out.push({
      slackUserId: normalized,
      employeeId: slug,
      displayName: member.displayName,
      portraitUrl: getAdminHeadshotUrl(member),
    });
  }
  return out;
}
