# Personal agent — Slack app setup (2 minutes)

Refs `BimRoss/makeacompany-ai#183` (personal agents). This is the manual paste-to-create flow until automated DCR is feasible — see `#183` open question 1.

## What you're doing

Each personal agent needs its own Slack app + bot user. You create the app in Slack's admin UI by pasting the manifest below, then paste two tokens back into `makeacompany.ai/me/agents/<slug>` so the makeacompany backend can wire the agent up.

## Prerequisites

- You're a workspace admin (or an Org admin granted Slack app-management permissions).
- You've picked a display name for the agent — e.g. "Bart". Keep it under 80 chars. The agent's slug on makeacompany will derive from this.
- You've created the agent record in the portal first (`makeacompany.ai/me/agents` → "+ New Agent"). The portal expects two tokens by the time you click "Connect".

## Step 1 — Create the Slack app from manifest

1. Open <https://api.slack.com/apps>.
2. Click **Create New App** → **From a manifest**.
3. Pick the BimRoss workspace.
4. Paste the JSON below. **Edit the two `REPLACE_ME` lines** before pasting:
   - `display_information.name` — agent display name ("Bart").
   - `features.bot_user.display_name` — same as above, Slack will use this as the bot's handle.

```json
{
  "display_information": {
    "name": "REPLACE_ME",
    "description": "Personal agent on makeacompany.ai",
    "background_color": "#1a1a1a"
  },
  "features": {
    "app_home": {
      "home_tab_enabled": false,
      "messages_tab_enabled": true,
      "messages_tab_read_only_enabled": false
    },
    "bot_user": {
      "display_name": "REPLACE_ME",
      "always_online": true
    }
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "app_mentions:read",
        "channels:history",
        "channels:read",
        "channels:join",
        "chat:write",
        "chat:write.public",
        "files:read",
        "files:write",
        "groups:history",
        "groups:read",
        "im:history",
        "im:read",
        "im:write",
        "mpim:history",
        "mpim:read",
        "mpim:write",
        "reactions:read",
        "reactions:write",
        "users:read",
        "users:read.email"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "bot_events": [
        "app_mention",
        "member_joined_channel",
        "message.channels",
        "message.groups",
        "message.im",
        "message.mpim",
        "reaction_added"
      ]
    },
    "interactivity": {
      "is_enabled": false
    },
    "org_deploy_enabled": false,
    "socket_mode_enabled": true,
    "token_rotation_enabled": false
  }
}
```

5. Click **Next** → **Create**.

## Step 2 — Generate the two tokens you'll paste back

You need a **bot token** (`xoxb-…`) and an **app-level token** (`xapp-…`). The bot token authenticates per-call Slack API requests; the app-level token authenticates the Socket Mode websocket the runtime uses to receive events.

### 2a — Bot token

1. In the app config sidebar, **OAuth & Permissions**.
2. Click **Install to Workspace** at the top → approve.
3. Copy the **Bot User OAuth Token** (`xoxb-…`). This is your bot token.

### 2b — App-level token

1. Sidebar → **Basic Information**.
2. Scroll to **App-Level Tokens** → **Generate Token and Scopes**.
3. Name: `socket-mode` (or anything; the name isn't read by anything else).
4. Add scope: `connections:write`.
5. Click **Generate**. Copy the `xapp-…` token. This is your app-level token.

### 2c — Bot user ID

Sidebar → **App Home** → scroll to **App Display Name** section. The bot user ID is shown there as `U0…`. Copy it. (Also visible via `users.lookupByEmail` once installed, but the UI is faster.)

## Step 3 — Paste back into makeacompany.ai

1. Return to `makeacompany.ai/me/agents/<slug>`.
2. In the **Slack credentials** panel, paste:
   - **Bot token** (`xoxb-…`).
   - **App-level token** (`xapp-…`).
   - **Bot user ID** (`U0…`).
3. Click **Save**.

The backend writes these into the per-agent Kubernetes Secret (`personal-agent-<slug>-secrets`, namespace `personal-agents`) and provisions the agent's deployment. The agent comes online within ~30s.

## Step 4 — Connect Google (optional, for Gmail/Drive/Calendar access)

On the same agent page, click **Connect Google** → standard Google consent → identity is bound to this agent (not to a channel, not to your other agents). The agent can now act as that Google identity.

## Step 5 — Smoke test

- **DM the agent in Slack** — open Slack, search for the agent's name, send "hi". You should get a reply within a few seconds.
- **@-mention in a channel where both you and the agent are members** — same.
- **@-mention by someone else** — they should get a one-time reply: "I only respond to <@you>." Subsequent pings from the same user in the same channel are dropped silently for the session.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "App not installed" error after paste | You generated tokens before installing the app to the workspace | Step 2a — click **Install to Workspace** first, then regenerate tokens |
| Agent doesn't reply to DMs | `im:history` / `im:read` scope not granted | Re-check the manifest scopes; reinstall the app |
| Agent doesn't reply to channel @-mentions | `app_mention` event not subscribed, or agent not in the channel | Manifest event_subscriptions check; `/invite @bart` in the channel |
| `socket_mode_enabled` reported as false in app config | Manifest pasted before Socket Mode was enabled at workspace level | Workspace owner enables Socket Mode in Slack workspace settings; recreate app |
| Token paste rejected with "invalid scope" | Wrong token in wrong field (xoxb in xapp slot, or vice versa) | Both start with letters — `xoxb-` is bot, `xapp-` is app-level. Don't swap. |

## What you do NOT need to do

- Don't set up a request URL — the runtime uses Socket Mode (websocket), not HTTP webhooks.
- Don't enable interactivity — the runtime doesn't use Block Kit interactive elements (yet).
- Don't add a redirect URL — agent OAuth is handled separately by makeacompany's portal, not Slack OAuth.
- Don't add a slash command — personal agents respond to DMs and @-mentions only.

## Why so manual

`#183` open question 1: full automation needs an `app_configurations:write` token on the BimRoss workspace, which requires either Enterprise Grid or an Org-level admin app. Until we have one, every new personal agent goes through this flow. Estimate: ~2 minutes per agent if you've done it before.

## Open follow-ups

- Screenshot pass: add inline images of the three Slack admin screens that matter (Create app from manifest, Install to Workspace, Generate App-Level Token). Track separately.
- Automate via `apps.manifest.create` when we have the right token. Closes the manual gap — see `#183` open question 1.
