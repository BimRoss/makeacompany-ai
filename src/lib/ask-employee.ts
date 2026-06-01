import { NextRequest, NextResponse } from "next/server";

type ChatRole = "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

const MAX_TURNS = 20;
const MAX_USER_CHARS = 2000;
const MAX_TOKENS = 1024;
const MODEL = "claude-sonnet-4-6";

type Bucket = {
  minute: { count: number; resetAt: number };
  hour: { count: number; resetAt: number };
};
const RATE_BUCKETS = new Map<string, Bucket>();
const PER_MINUTE = 3;
const PER_HOUR = 80;

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function checkRate(ip: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  let b = RATE_BUCKETS.get(ip);
  if (!b) {
    b = {
      minute: { count: 0, resetAt: now + 60_000 },
      hour: { count: 0, resetAt: now + 3_600_000 },
    };
    RATE_BUCKETS.set(ip, b);
  }
  if (now >= b.minute.resetAt) {
    b.minute.count = 0;
    b.minute.resetAt = now + 60_000;
  }
  if (now >= b.hour.resetAt) {
    b.hour.count = 0;
    b.hour.resetAt = now + 3_600_000;
  }
  if (b.minute.count >= PER_MINUTE) {
    return { ok: false, retryAfter: Math.ceil((b.minute.resetAt - now) / 1000) };
  }
  if (b.hour.count >= PER_HOUR) {
    return { ok: false, retryAfter: Math.ceil((b.hour.resetAt - now) / 1000) };
  }
  b.minute.count += 1;
  b.hour.count += 1;
  if (RATE_BUCKETS.size > 10_000) {
    for (const [k, v] of RATE_BUCKETS) {
      if (now >= v.hour.resetAt) RATE_BUCKETS.delete(k);
    }
  }
  return { ok: true };
}

function sanitizeMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const trimmed = content.slice(0, MAX_USER_CHARS).trim();
    if (!trimmed) continue;
    out.push({ role, content: trimmed });
  }
  if (out.length === 0) return null;
  if (out[out.length - 1].role !== "user") return null;
  return out.slice(-MAX_TURNS);
}

export async function handleAskEmployee(
  req: NextRequest,
  systemPrompt: string,
): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY_ASK;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY_ASK not set" }, { status: 500 });
  }

  const rate = checkRate(clientIp(req));
  if (!rate.ok) {
    return NextResponse.json(
      { error: "rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
    );
  }

  let messages: ChatMessage[] | null = null;
  try {
    const body = (await req.json()) as { messages?: unknown };
    messages = sanitizeMessages(body.messages);
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  if (!messages) {
    return NextResponse.json(
      { error: "messages must be a non-empty array ending in a user turn" },
      { status: 400 },
    );
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      system: systemPrompt,
      messages,
    }),
  });

  if (!resp.ok || !resp.body) {
    const detail = resp.body ? await resp.text() : "no body";
    return NextResponse.json(
      { error: "anthropic api error", status: resp.status, detail },
      { status: 502 },
    );
  }

  const upstream = resp.body;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, nl).trimEnd();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const ev = JSON.parse(payload) as {
                type?: string;
                delta?: { type?: string; text?: string };
              };
              if (
                ev.type === "content_block_delta" &&
                ev.delta?.type === "text_delta" &&
                ev.delta.text
              ) {
                controller.enqueue(encoder.encode(ev.delta.text));
              }
            } catch {
              // ignore malformed SSE line
            }
          }
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });

  return new Response(out, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
