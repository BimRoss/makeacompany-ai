#!/usr/bin/env node
/**
 * Post-migration / ops: same flow as /admin Companies strip — list Slack channels from
 * slack-orchestrator GET /debug/member-channels, fetch human user ids per channel via
 * GET /debug/channel-members, then POST Go backend /v1/admin/company-channels/discover.
 *
 * Required env:
 *   ORCHESTRATOR_DEBUG_BASE_URL — e.g. http://127.0.0.1:8080 or cluster orchestrator URL
 *   BACKEND_API_BASE_URL        — Go API origin, e.g. http://localhost:8090
 *   ADMIN_SESSION_TOKEN          — mac_admin_session token (Bearer) for /v1/admin/company-channels/discover
 *
 * Optional:
 *   ORCHESTRATOR_DEBUG_TOKEN    — Bearer for orchestrator if debug routes are locked down
 *   DISCOVER_MAX_CHANNELS         — max channels from member-channels to process (default: all)
 *   DISCOVER_MEMBER_FETCH_CONCURRENCY — parallel channel-members fetches (default: 6)
 *
 * Backend caps 200 channels per discover request; this script batches automatically.
 *
 * Usage:
 *   set -a && source .env && set +a && node scripts/company-channels-discover-from-orchestrator.mjs
 */

function trim(v) {
  return (v || "").trim();
}

function requireEnv(name) {
  const value = trim(process.env[name]);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optionalEnv(name, fallback = "") {
  const v = trim(process.env[name]);
  return v || fallback;
}

function normalizeBaseURL(base) {
  const b = trim(base);
  if (!b) return "";
  return b.endsWith("/") ? b.slice(0, -1) : b;
}

function orchHeaders() {
  const token = optionalEnv("ORCHESTRATOR_DEBUG_TOKEN");
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function backendHeaders() {
  const token = requireEnv("ADMIN_SESSION_TOKEN");
  const headers = { "Content-Type": "application/json" };
  headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 2000)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function mapLimit(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(concurrency, items.length || 1);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

const MAX_PER_DISCOVER_REQUEST = 200;

async function main() {
  const orchBase = normalizeBaseURL(requireEnv("ORCHESTRATOR_DEBUG_BASE_URL"));
  const backendBase = normalizeBaseURL(requireEnv("BACKEND_API_BASE_URL"));

  const maxChannels = optionalEnv("DISCOVER_MAX_CHANNELS");
  const maxN = maxChannels ? parseInt(maxChannels, 10) : 0;
  if (maxChannels && (Number.isNaN(maxN) || maxN < 0)) {
    throw new Error("DISCOVER_MAX_CHANNELS must be a non-negative integer");
  }

  const concurrency = Math.max(
    1,
    parseInt(optionalEnv("DISCOVER_MEMBER_FETCH_CONCURRENCY", "6"), 10) || 6,
  );

  const memberChannelsURL = `${orchBase}/debug/member-channels`;
  console.error(`Fetching ${memberChannelsURL}`);
  const listPayload = await fetchJSON(memberChannelsURL, { headers: orchHeaders() });
  const rows = Array.isArray(listPayload.channels) ? listPayload.channels : [];
  let slice = rows;
  if (maxN > 0) {
    slice = rows.slice(0, maxN);
  }

  console.error(
    `Channels from Slack: ${rows.length}${maxN > 0 ? ` (processing ${slice.length})` : ""}`,
  );

  const channelsWithOwners = await mapLimit(slice, concurrency, async (row) => {
    const channelId = trim(row.channel_id);
    const name = trim(row.name) || channelId;
    let owner_ids = [];
    if (!channelId) {
      return null;
    }
    try {
      const u = new URL(`${orchBase}/debug/channel-members`);
      u.searchParams.set("channel_id", channelId);
      const mem = await fetchJSON(u.toString(), { headers: orchHeaders() });
      if (Array.isArray(mem.human_user_ids)) {
        owner_ids = mem.human_user_ids.filter((id) => typeof id === "string" && id.trim());
      }
    } catch (e) {
      console.error(`channel-members failed for ${channelId}:`, e.message || e);
    }
    return { channel_id: channelId, name, owner_ids };
  });

  const payloadChannels = channelsWithOwners.filter(Boolean);
  if (payloadChannels.length === 0) {
    console.error("No channels to discover. Is the orchestrator bot in at least one channel?");
    process.exit(1);
  }

  const discoverURL = `${backendBase}/v1/admin/company-channels/discover`;
  let totalUpserted = 0;
  for (let offset = 0; offset < payloadChannels.length; offset += MAX_PER_DISCOVER_REQUEST) {
    const chunk = payloadChannels.slice(offset, offset + MAX_PER_DISCOVER_REQUEST);
    console.error(
      `POST discover ${offset + 1}-${offset + chunk.length} of ${payloadChannels.length} → ${discoverURL}`,
    );
    const out = await fetchJSON(discoverURL, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({ channels: chunk }),
    });
    const n = typeof out.upserted_count === "number" ? out.upserted_count : (out.upserted || []).length;
    totalUpserted += n;
    console.error(`  upserted_count: ${n}`, out.redisKey ? `redisKey: ${out.redisKey}` : "");
  }

  console.error(`Done. Total upserted (sum of chunks): ${totalUpserted}`);
  console.log(JSON.stringify({ ok: true, channels: payloadChannels.length, totalUpserted }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
