import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { meSessionCookieName } from "@/lib/me-session-cookies";

export const dynamic = "force-dynamic";

const FENCE_START = "<!-- yt-intel-start -->";
const FENCE_END = "<!-- yt-intel-end -->";

// Mirror of the helpers in ../ingest/route.ts. Duplicated rather than shared
// because both routes will likely diverge (e.g. ingest may grow streaming
// retries, delete may grow bulk-clear) — premature shared helper would
// constrain both.
type YtSource = { url: string; title: string; bullets: string[]; ingestedAt: string };

function stripFenced(prompt: string): string {
  const startIdx = prompt.indexOf(FENCE_START);
  const endIdx = prompt.indexOf(FENCE_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return prompt;
  const before = prompt.slice(0, startIdx).replace(/\s+$/, "");
  const after = prompt.slice(endIdx + FENCE_END.length).replace(/^\s+/, "");
  return [before, after].filter(Boolean).join("\n\n");
}

function parseFencedSources(prompt: string): YtSource[] {
  const startIdx = prompt.indexOf(FENCE_START);
  const endIdx = prompt.indexOf(FENCE_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return [];
  const block = prompt.slice(startIdx + FENCE_START.length, endIdx).trim();
  if (!block) return [];
  try {
    const parsed = JSON.parse(block) as YtSource[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderFenced(sources: YtSource[]): string {
  if (sources.length === 0) return "";
  const prose = sources
    .map((s) => {
      const title = s.title?.trim() || s.url;
      const lines = [`### ${title}`, ...s.bullets.map((b) => `- ${b}`)];
      return lines.join("\n");
    })
    .join("\n\n");
  return [
    "## Learned from videos",
    "",
    prose,
    "",
    FENCE_START,
    JSON.stringify(sources),
    FENCE_END,
  ].join("\n");
}

function composePrompt(persona: string, sources: YtSource[]): string {
  const cleanPersona = persona.replace(/\s+$/, "");
  const fenced = renderFenced(sources);
  if (!fenced) return cleanPersona;
  if (!cleanPersona) return fenced;
  return `${cleanPersona}\n\n${fenced}`;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(meSessionCookieName)?.value ?? "";
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { url?: string };
  try {
    body = (await request.json()) as { url?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  const backend = resolveBackendBaseURL().replace(/\/$/, "");
  const authHeader = { Authorization: `Bearer ${token}` };

  const mineRes = await fetch(`${backend}/v1/me/personal-agents/mine`, {
    headers: authHeader,
    cache: "no-store",
  });
  if (!mineRes.ok) {
    return NextResponse.json({ error: "could not read current agent" }, { status: mineRes.status });
  }
  const mine = (await mineRes.json()) as { systemPrompt?: string };
  const currentPrompt = (mine.systemPrompt ?? "").trim();
  const persona = stripFenced(currentPrompt);
  const sources = parseFencedSources(currentPrompt).filter((s) => s.url !== url);
  const nextPrompt = composePrompt(persona, sources);

  // The /edit endpoint treats empty string as "no change" — so when removing
  // the last source AND persona is also blank we'd inadvertently no-op. Send
  // a single space in that pathological case to land an actual write; the
  // K8s Secret then carries a space which the agent treats as no persona.
  const editPayload = nextPrompt.trim() === "" ? " " : nextPrompt;
  const editRes = await fetch(`${backend}/v1/me/personal-agents/edit`, {
    method: "POST",
    headers: { ...authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt: editPayload }),
  });
  if (!editRes.ok) {
    const detail = await editRes.text().catch(() => "");
    return NextResponse.json(
      { error: `persist failed: ${detail.slice(0, 200)}` },
      { status: editRes.status },
    );
  }
  return NextResponse.json({ ok: true, sources });
}
