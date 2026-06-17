import { cookies } from "next/headers";

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { meSessionCookieName } from "@/lib/me-session-cookies";

export const dynamic = "force-dynamic";

// Server-Sent Events ingest orchestrator. Splits the work into named stages
// the browser can paint distinct pills against:
//
//   stage: fetching          (we accepted the URL, asking the transcribe svc)
//   stage: transcribing      (transcribe call resolved; harvest about to start)
//   stage: harvesting        (LLM call in flight)
//   stage: done              (bullets persisted onto SystemPrompt)
//   stage: error             (terminal; payload.message has the reason)
//
// Persistence: we read the current SystemPrompt off the agent record, splice
// in the harvested bullets between marker fences (`<!-- yt-intel-start -->`
// ... `<!-- yt-intel-end -->`), and POST the full new value back to the
// existing /v1/me/personal-agents/edit. That sidesteps a Go schema change at
// the cost of growing SystemPrompt as videos accumulate. The /me UI strips
// the fenced block before rendering the Personality row.

const TRANSCRIBE_BASE_URL = (process.env.TRANSCRIBE_BASE_URL ?? "http://transcribe:8080").replace(
  /\/$/,
  "",
);

const FENCE_START = "<!-- yt-intel-start -->";
const FENCE_END = "<!-- yt-intel-end -->";

type YtSource = { url: string; title: string; bullets: string[]; ingestedAt: string };

function stripFenced(prompt: string): string {
  const startIdx = prompt.indexOf(FENCE_START);
  const endIdx = prompt.indexOf(FENCE_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return prompt;
  // Also eat any leading whitespace before the start fence — the renderer
  // adds "\n\n" before it, and we don't want trailing blanks in the persona.
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
  // JSON-encoded array sits immediately inside the fence — parsing markdown
  // bullets back into structured form would lose the URL anchor we need for
  // per-source delete.
  try {
    const parsed = JSON.parse(block) as YtSource[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderFenced(sources: YtSource[]): string {
  if (sources.length === 0) return "";
  // The fence wraps the JSON; outside the fence we also emit human-readable
  // markdown so the agent's instructions.md (which sees the WHOLE prompt
  // verbatim) still gets prose to chew on, not just JSON. The strip step
  // above only runs in the UI; the backend's K8s Secret carries the full
  // value including both prose and JSON.
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

function sse(event: string, payload: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(meSessionCookieName)?.value ?? "";
  if (!token) {
    return new Response("unauthorized", { status: 401 });
  }
  let body: { url?: string };
  try {
    body = (await request.json()) as { url?: string };
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const url = (body.url ?? "").trim();
  if (!url) {
    return new Response("url required", { status: 400 });
  }

  const backend = resolveBackendBaseURL().replace(/\/$/, "");
  const authHeader = { Authorization: `Bearer ${token}` };

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, payload: Record<string, unknown>) =>
        controller.enqueue(enc.encode(sse(event, payload)));
      const fail = (message: string, status = "error") => {
        send(status, { message });
        controller.close();
      };

      try {
        send("stage", { stage: "fetching" });

        // --- transcribe ---
        const trRes = await fetch(`${TRANSCRIBE_BASE_URL}/transcribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        if (!trRes.ok) {
          const detail = await trRes.text().catch(() => "");
          fail(`transcribe failed (${trRes.status}): ${detail.slice(0, 200)}`);
          return;
        }
        const tr = (await trRes.json()) as { videoId: string; title: string; transcript: string };
        send("stage", {
          stage: "transcribing",
          title: tr.title,
          transcriptChars: tr.transcript.length,
        });

        // --- harvest ---
        send("stage", { stage: "harvesting" });
        const hvRes = await fetch(`${TRANSCRIBE_BASE_URL}/harvest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: tr.transcript, title: tr.title }),
        });
        if (!hvRes.ok) {
          const detail = await hvRes.text().catch(() => "");
          fail(`harvest failed (${hvRes.status}): ${detail.slice(0, 200)}`);
          return;
        }
        const hv = (await hvRes.json()) as { bullets: string[] };
        if (!hv.bullets?.length) {
          fail("harvest produced no bullets");
          return;
        }

        // --- read current agent record + splice fenced block ---
        const mineRes = await fetch(`${backend}/v1/me/personal-agents/mine`, {
          headers: authHeader,
          cache: "no-store",
        });
        if (!mineRes.ok) {
          fail(`could not read current agent (${mineRes.status})`);
          return;
        }
        const mine = (await mineRes.json()) as { systemPrompt?: string };
        const currentPrompt = (mine.systemPrompt ?? "").trim();
        const persona = stripFenced(currentPrompt);
        const existingSources = parseFencedSources(currentPrompt);
        const filtered = existingSources.filter((s) => s.url !== url);
        const newSource: YtSource = {
          url,
          title: tr.title || url,
          bullets: hv.bullets,
          ingestedAt: new Date().toISOString(),
        };
        const nextSources = [...filtered, newSource];
        const nextPrompt = composePrompt(persona, nextSources);

        // --- persist via existing /edit endpoint ---
        const editRes = await fetch(`${backend}/v1/me/personal-agents/edit`, {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ systemPrompt: nextPrompt }),
        });
        if (!editRes.ok) {
          const detail = await editRes.text().catch(() => "");
          fail(`persist failed (${editRes.status}): ${detail.slice(0, 200)}`);
          return;
        }

        send("done", {
          stage: "done",
          source: newSource,
          sources: nextSources,
        });
        controller.close();
      } catch (e) {
        const message = e instanceof Error ? e.message : "unknown error";
        try {
          send("error", { message });
        } catch {
          /* stream already closed */
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
