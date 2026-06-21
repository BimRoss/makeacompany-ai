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
//   stage: done              (bullets persisted onto the agent record)
//   stage: error             (terminal; payload.message has the reason)
//
// Persistence: harvested bullets POST straight to the backend's structured
// /v1/me/personal-agents/youtube-sources/add endpoint, which stores them on
// PersonalAgentRecord.YouTubeSources (separate from the typed personality).
// The agent fetches them at runtime via the lazy-load /knowledge endpoint
// (#607), not via the system prompt. See #605 / #608.

const TRANSCRIBE_BASE_URL = (process.env.TRANSCRIBE_BASE_URL ?? "http://transcribe:8080").replace(
  /\/$/,
  "",
);

type YtSource = { url: string; title: string; bullets: string[]; ingestedAt: string };

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

        // --- persist via structured YouTube-sources endpoint ---
        const newSource: YtSource = {
          url,
          title: tr.title || url,
          bullets: hv.bullets,
          ingestedAt: new Date().toISOString(),
        };
        const addRes = await fetch(
          `${backend}/v1/me/personal-agents/youtube-sources/add`,
          {
            method: "POST",
            headers: { ...authHeader, "Content-Type": "application/json" },
            body: JSON.stringify({ url, title: newSource.title, bullets: hv.bullets }),
          },
        );
        if (!addRes.ok) {
          const detail = await addRes.text().catch(() => "");
          fail(`persist failed (${addRes.status}): ${detail.slice(0, 200)}`);
          return;
        }
        const addBody = (await addRes.json().catch(() => ({}))) as {
          youtubeSources?: YtSource[];
        };
        const nextSources = addBody.youtubeSources ?? [newSource];

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
