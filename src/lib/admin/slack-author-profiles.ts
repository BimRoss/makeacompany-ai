import type { SlackBotAuthorProfile } from "@/lib/admin/slack-bot-author-env";
import { getSlackBotAuthorProfilesFromEnv } from "@/lib/admin/slack-bot-author-env";

type SlackUsersListResponse = {
  ok?: boolean;
  error?: string;
  members?: Array<{
    id?: string;
    name?: string;
    profile?: {
      real_name?: string;
      display_name?: string;
      image_192?: string;
      image_72?: string;
      image_48?: string;
      image_32?: string;
    };
  }>;
  response_metadata?: { next_cursor?: string };
};

const SLACK_USERS_LIST_URL = "https://slack.com/api/users.list";
const MAX_USERS_LIST_PAGES = 10;
const PAGE_LIMIT = 200;

function bestSlackDisplayName(member: { name?: string; profile?: { real_name?: string; display_name?: string } }): string {
  const real = String(member.profile?.real_name ?? "").trim();
  if (real) {
    return real;
  }
  const display = String(member.profile?.display_name ?? "").trim();
  if (display) {
    return display;
  }
  const username = String(member.name ?? "").trim();
  return username || "Unknown";
}

function bestSlackAvatarUrl(
  profile: { image_192?: string; image_72?: string; image_48?: string; image_32?: string } | undefined,
): string {
  const candidates = [profile?.image_192, profile?.image_72, profile?.image_48, profile?.image_32];
  for (const value of candidates) {
    const url = String(value ?? "").trim();
    if (url) {
      return url;
    }
  }
  return "";
}

function mergeProfile(
  bySlackUser: Map<string, SlackBotAuthorProfile>,
  row: SlackBotAuthorProfile,
  preferExisting: boolean,
) {
  const normalizedId = row.slackUserId.trim().toUpperCase();
  if (!normalizedId) {
    return;
  }
  const existing = bySlackUser.get(normalizedId);
  if (existing && preferExisting) {
    return;
  }
  bySlackUser.set(normalizedId, { ...row, slackUserId: normalizedId });
}

async function fetchSlackUsersListProfiles(token: string): Promise<SlackBotAuthorProfile[]> {
  const rows: SlackBotAuthorProfile[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_USERS_LIST_PAGES; page++) {
    const body = new URLSearchParams();
    body.set("limit", String(PAGE_LIMIT));
    if (cursor) {
      body.set("cursor", cursor);
    }
    const response = await fetch(SLACK_USERS_LIST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      cache: "no-store",
    });
    if (!response.ok) {
      break;
    }
    const payload = (await response.json().catch(() => null)) as SlackUsersListResponse | null;
    if (!payload?.ok || !Array.isArray(payload.members)) {
      break;
    }
    for (const member of payload.members) {
      const slackUserId = String(member.id ?? "").trim().toUpperCase();
      if (!slackUserId) {
        continue;
      }
      const displayName = bestSlackDisplayName(member);
      const avatarUrl = bestSlackAvatarUrl(member.profile);
      rows.push({
        slackUserId,
        employeeId: "",
        displayName: displayName || slackUserId,
        portraitUrl: avatarUrl,
      });
    }
    const next = String(payload.response_metadata?.next_cursor ?? "").trim();
    if (!next) {
      break;
    }
    cursor = next;
  }
  return rows;
}

/**
 * Transcript author lookup:
 * 1) Slack `users.list` — names + profile images for the workspace (same source as the admin Slack Users table).
 * 2) Env mappings (`*_SLACK_BOT_ID`, `MULTIAGENT_BOT_USER_IDS`) only for Slack user IDs missing from that list
 *    (display name from env; portrait left empty so the UI shows initials until Slack can supply one).
 */
export async function getSlackAuthorProfiles(opts?: { slackToken?: string | null }): Promise<SlackBotAuthorProfile[]> {
  const bySlackUser = new Map<string, SlackBotAuthorProfile>();
  const token = String(opts?.slackToken ?? "").trim();
  if (token) {
    try {
      const slackRows = await fetchSlackUsersListProfiles(token);
      for (const row of slackRows) {
        mergeProfile(bySlackUser, row, false);
      }
    } catch {
      // Best-effort; env fallbacks below may still label known bot IDs.
    }
  }

  for (const row of getSlackBotAuthorProfilesFromEnv()) {
    mergeProfile(bySlackUser, row, true);
  }

  return [...bySlackUser.values()];
}
