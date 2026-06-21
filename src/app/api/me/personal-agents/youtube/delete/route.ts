import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { meSessionCookieName } from "@/lib/me-session-cookies";

export const dynamic = "force-dynamic";

type YtSource = { url: string; title: string; bullets: string[]; ingestedAt: string };

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

  // Structured remove — the backend deletes from PersonalAgentRecord.YouTubeSources
  // and rolls the agent's pod. No more fenced systemPrompt round-trip (#608).
  const res = await fetch(
    `${backend}/v1/me/personal-agents/youtube-sources/remove`,
    {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `persist failed: ${detail.slice(0, 200)}` },
      { status: res.status },
    );
  }
  const payload = (await res.json().catch(() => ({}))) as { youtubeSources?: YtSource[] };
  return NextResponse.json({ ok: true, sources: payload.youtubeSources ?? [] });
}
