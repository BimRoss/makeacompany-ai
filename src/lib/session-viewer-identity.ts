import { displayNameFromAuthEmail } from "@/lib/auth-email-display-name";

/**
 * Profile row shape from `/api/admin/slack-bot-author-profiles` and portal equivalent
 * (Slack `users.list` merge + env bot IDs).
 */
export type SlackProfileRowForIdentity = {
  slackUserId?: string;
  displayName?: string;
  portraitUrl?: string;
  email?: string;
};

/** Row from `/api/admin/slack-workspace-users` (Redis / Slack snapshot). */
export type SlackWorkspaceUserRowForIdentity = {
  slackUserId?: string;
  email?: string;
  displayName?: string;
  realName?: string;
  profileImageUrl?: string;
};

export type SessionViewerIdentity = {
  displayName: string;
  portraitUrl?: string;
};

/**
 * Resolves the signed-in human for the channel header chip and post-auth welcome toasts.
 * Prefer Slack workspace user + author profiles by session email, then local-part display from email.
 */
export function buildSessionViewerIdentity(
  sessionEmail: string,
  opts: {
    profileRows: SlackProfileRowForIdentity[] | null | undefined;
    workspaceUser?: SlackWorkspaceUserRowForIdentity;
  },
): SessionViewerIdentity | null {
  const email = String(sessionEmail ?? "")
    .trim()
    .toLowerCase();
  if (!email) {
    return null;
  }

  let displayName = "";
  let portraitUrl: string | undefined;

  const wu = opts.workspaceUser;
  if (wu) {
    const pic = String(wu.profileImageUrl ?? "").trim();
    if (pic) {
      portraitUrl = pic;
    }
  }

  const rows = opts.profileRows;
  if (Array.isArray(rows)) {
    const profileRow = rows.find((r) => String(r.email ?? "").trim().toLowerCase() === email);
    if (profileRow) {
      const dn = String(profileRow.displayName ?? "").trim();
      if (dn) {
        displayName = dn;
      }
      const pu = String(profileRow.portraitUrl ?? "").trim();
      if (pu && !portraitUrl) {
        portraitUrl = pu;
      }
    }
  }

  if (!displayName && wu) {
    displayName =
      String(wu.displayName ?? "").trim() ||
      String(wu.realName ?? "").trim();
  }
  if (!displayName) {
    displayName = displayNameFromAuthEmail(email);
  }

  return { displayName, ...(portraitUrl ? { portraitUrl } : {}) };
}
