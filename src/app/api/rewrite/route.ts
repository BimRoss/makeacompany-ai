import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const VOICES = ["joanne", "ross", "duo"] as const;
type Voice = (typeof VOICES)[number];

const VOICE_BRIEFS: Record<Voice, string> = {
  joanne:
    "Joanne is the AI Chief of Staff. She runs operations: customer emails, follow-ups, scheduling, vendor pings, weekly updates. Confident, warm, gets-things-done. Speaks in first person ('I'm Joanne' or 'I'll handle…').",
  ross:
    "Ross is the AI Software Developer. He ships code: features, fixes, scripts, integrations, tests. Direct, builder energy. Speaks in first person ('I'm Ross' or 'I'll ship…'). Uses developer language naturally (PR, repo, tests).",
  duo:
    "Speak as the product, not as a character. Punchy marketer / great seller energy. Frame Joanne + Ross as a 2-person AI team in the buyer's Slack. Reference the price anchor ('what Claude Code costs') or the zero-setup / hosted-in-Slack angle.",
};

const EXAMPLES = `Examples of the right snappy length and tone:

Joanne example 1: "I'm Joanne. Send me the emails, follow-ups, and calendar chaos. I'll handle the rest and only ping you when it matters."

Joanne example 2: "I run ops so you can run the company. Customer replies, updates, vendor pings, calendar Tetris. Drop it in Slack. Done."

Ross example 1: "I'm Ross. Describe what you want built. I'll ship it. Real repo, real PRs, real code."

Ross example 2: "Message me what to ship. PR up the same hour, tests included. You review and merge."

Duo example 1: "Joanne runs ops. Ross writes code. You make the calls only a founder can. It's basically a whole company in your Slack, for what Claude Code costs."

Duo example 2: "A Chief of Staff and a Developer, living in your Slack. Nothing to set up. Two new DMs and a whole company at your fingertips."`;

function buildPrompt(voice: Voice): { system: string; user: string } {
  const system = `You write hero-section copy for makeacompany.ai — a product that gives users two AI teammates inside their Slack workspace: Joanne (Chief of Staff) and Ross (Software Developer), for $99/mo (the price of Claude Code, hosted in your Slack with zero setup — we handle hosting, the Claude bill, everything, accessible anywhere Slack runs).

The headline is "The Power of Claude, The Ease of Slack." Your job is to write ONE punchy variant of the subhead that appears when a user clicks a "Tell me more" pill. It should feel like the named character (or the product itself) is talking directly to the reader.

Rules:
- 1 to 3 sentences. Snappy. No filler.
- No em dashes. Use periods or commas instead.
- No marketing clichés (no "unleash", "transform", "supercharge", "revolutionize").
- Do NOT mention "API keys" — that fights the zero-setup pitch.
- Do not wrap the output in quotes or markdown. Plain text only.
- Match the voice brief and example length.

${EXAMPLES}`;

  const user = `Voice: ${voice}
${VOICE_BRIEFS[voice]}

Write one fresh variant in this voice. Output only the variant text — no preamble, no quotes, no explanation.`;

  return { system, user };
}

type Bucket = { minute: { count: number; resetAt: number }; hour: { count: number; resetAt: number } };
const RATE_BUCKETS = new Map<string, Bucket>();
const PER_MINUTE = 10;
const PER_HOUR = 60;

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
    b = { minute: { count: 0, resetAt: now + 60_000 }, hour: { count: 0, resetAt: now + 3_600_000 } };
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

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const rate = checkRate(clientIp(req));
  if (!rate.ok) {
    return NextResponse.json(
      { error: "rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
    );
  }

  let voice: Voice = "duo";
  try {
    const body = (await req.json()) as { voice?: string };
    if (body.voice && (VOICES as readonly string[]).includes(body.voice)) {
      voice = body.voice as Voice;
    }
  } catch {
    // empty body is fine, default to duo
  }

  const { system, user } = buildPrompt(voice);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      stream: true,
      system,
      messages: [{ role: "user", content: user }],
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
      "x-rewrite-voice": voice,
    },
  });
}
