import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

type OrchestratorPayload = {
  schema_version: number;
  entries: unknown[];
};

/**
 * Proxies to slack-orchestrator GET /debug/decisions.
 * Sends `Authorization: Bearer <ORCHESTRATOR_DEBUG_TOKEN>` only when that env is set (optional lockdown).
 * Otherwise calls unauthenticated — slack-orchestrator defaults to allowing anonymous debug reads.
 */
export async function GET(req: Request) {
  const unauthorized = await requireAdminApiSession();
  if (unauthorized) {
    return unauthorized;
  }

  const base = process.env.ORCHESTRATOR_DEBUG_BASE_URL?.trim().replace(/\/$/, "");
  if (!base) {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "Set ORCHESTRATOR_DEBUG_BASE_URL. Local example: kubectl port-forward svc/slack-orchestrator 18081:8080 -n slack-orchestrator then ORCHESTRATOR_DEBUG_BASE_URL=http://127.0.0.1:18081",
      },
      { status: 503 },
    );
  }

  const serverToken = process.env.ORCHESTRATOR_DEBUG_TOKEN?.trim();

  const u = new URL(req.url);
  const limit = u.searchParams.get("limit") ?? "100";
  const target = new URL("/debug/decisions", base);
  target.searchParams.set("limit", limit);

  const headers: HeadersInit = {};
  if (serverToken) {
    headers.Authorization = `Bearer ${serverToken}`;
  }

  const res = await fetch(target.toString(), {
    headers,
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
