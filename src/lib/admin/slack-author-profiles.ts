import type { SlackBotAuthorProfile } from "@/lib/admin/slack-bot-author-env";
import { getSlackBotAuthorProfilesFromEnv } from "@/lib/admin/slack-bot-author-env";

type SlackUsersListResponse = {
  ok?: boolean;
  error?: string;
  members?: Array<{
    id?: string;
    name?: string;
    profile?: {
      email?: string;
      real_name?: string;
      display_name?: string;
      image_512?: string;
      image_original?: string;
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
  profile:
    | {
        image_512?: string;
        image_original?: string;
        image_192?: string;
        image_72?: string;
        image_48?: string;
        image_32?: string;
      }
    | undefined,
): string {
  const candidates = [
    profile?.image_512,
    profile?.image_original,
    profile?.image_192,
    profile?.image_72,
    profile?.image_48,
    profile?.image_32,
  ];
  for (const value of candidates) {
    const url = String(value ?? "").trim();
    if (url) {
      return url;
    }
  }
  return "";
}

const SLACK_USERS_INFO_URL = "https://slack.com/api/users.info";

type SlackUserInfoResponse = {
  ok?: boolean;
  error?: string;
  user?: {
    id?: string;
    profile?: {
      real_name?: string;
      display_name?: string;
      image_512?: string;
      image_original?: string;
      image_192?: string;
      image_72?: string;
      image_48?: string;
      image_32?: string;
    };
  };
};

/** Fills `profile.image_*` when `users.list` omits them (common for bot users). */
async function fetchSlackUserInfoPortrait(token: string, slackUserId: string): Promise<string> {
  const id = slackUserId.trim();
  if (!id) {
    return "";
  }
  const body = new URLSearchParams();
  body.set("user", id);
  const response = await fetch(SLACK_USERS_INFO_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });
  if (!response.ok) {
    return "";
  }
  const payload = (await response.json().catch(() => null)) as SlackUserInfoResponse | null;
  if (!payload?.ok || !payload.user) {
    return "";
  }
  return bestSlackAvatarUrl(payload.user.profile);
}

async function enrichMissingPortraitsFromUserInfo(
  token: string,
  bySlackUser: Map<string, SlackBotAuthorProfile>,
): Promise<void> {
  const missing = [...bySlackUser.values()].filter((r) => !String(r.portraitUrl ?? "").trim());
  /** Small workspace cap; each user is one Slack HTTP round-trip. */
  const cap = 48;
  const slice = missing.slice(0, cap);
  const concurrency = 6;
  for (let i = 0; i < slice.length; i += concurrency) {
    const chunk = slice.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (row) => {
        try {
          const url = await fetchSlackUserInfoPortrait(token, row.slackUserId);
          if (!url) {
            return;
          }
          const k = row.slackUserId.trim().toUpperCase();
          const cur = bySlackUser.get(k);
          if (!cur) {
            return;
          }
          bySlackUser.set(k, { ...cur, portraitUrl: url });
        } catch {
          // best-effort per user
        }
      }),
    );
  }
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
      const email = String(member.profile?.email ?? "").trim().toLowerCase();
      rows.push({
        slackUserId,
        employeeId: "",
        displayName: displayName || slackUserId,
        portraitUrl: avatarUrl,
        ...(email ? { email } : {}),
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
 *    (display name from env; portrait left empty until step 3 when possible).
 * 3) Slack `users.info` per user still missing `portraitUrl` — `users.list` often omits `image_*` for bots;
 *    this fills transcript avatars without bundling static assets.
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

  if (token) {
    try {
      await enrichMissingPortraitsFromUserInfo(token, bySlackUser);
    } catch {
      // best-effort enrichment
    }
  }

  return [...bySlackUser.values()];
}
