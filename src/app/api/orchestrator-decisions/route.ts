import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type OrchestratorPayload = {
  schema_version: number;
  entries: unknown[];
};

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) {
    return null;
  }
  return h.slice("Bearer ".length).trim();
}

/**
 * Proxies to slack-orchestrator GET /debug/decisions.
 * Requires Authorization: Bearer <ORCHESTRATOR_DEBUG_TOKEN> (same secret as the orchestrator).
 */
export async function GET(req: Request) {
  const expected = process.env.ORCHESTRATOR_DEBUG_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: "not_configured", message: "Set ORCHESTRATOR_DEBUG_TOKEN and ORCHESTRATOR_DEBUG_BASE_URL on the server." },
      { status: 503 },
    );
  }
  const token = bearer(req);
  if (!token || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const base = process.env.ORCHESTRATOR_DEBUG_BASE_URL?.trim().replace(/\/$/, "");
  if (!base) {
    return NextResponse.json(
      { error: "not_configured", message: "Set ORCHESTRATOR_DEBUG_BASE_URL (e.g. http://slack-orchestrator.slack-orchestrator.svc.cluster.local:8080)." },
      { status: 503 },
    );
  }

  const u = new URL(req.url);
  const limit = u.searchParams.get("limit") ?? "100";
  const target = new URL("/debug/decisions", base);
  target.searchParams.set("limit", limit);

  const res = await fetch(target.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { error: "upstream", status: res.status, body: text.slice(0, 2000) },
      { status: res.status === 401 || res.status === 403 ? res.status : 502 },
    );
  }

  try {
    const data = JSON.parse(text) as OrchestratorPayload;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "invalid_upstream_json", body: text.slice(0, 500) }, { status: 502 });
  }
}
