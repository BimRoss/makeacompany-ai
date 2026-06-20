import { NextResponse } from "next/server";

import { hasValidAdminApiSession } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

// POST /api/admin/provision-channel { email }
//
// Calls Joanne's cluster-internal /admin/provision-co-channel endpoint to
// fire the <slug>-co provision flow against a known account. Used by the
// admin-page button so an operator can dogfood the team_join onboarding
// path without waiting for a real new-member join.
//
// Direct frontend → Joanne hop, matching the oauth-pool pattern: env
// JOANNE_ADMIN_URL + JOANNE_ADMIN_TOKEN are already mounted in the
// frontend pod (rancher-admin admin/apps/makeacompany-ai/frontend.yaml).
// The Go backend is not in this loop — provisioning is a Joanne concern.

const JOANNE_TIMEOUT_MS = 30_000;

export async function POST(request: Request) {
  const adminOk = await hasValidAdminApiSession();
  if (!adminOk) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) {
    return NextResponse.json({ ok: false, error: "email required" }, { status: 400 });
  }

  const joanneURL = process.env.JOANNE_ADMIN_URL ?? "http://claude-code-joanne.claude-code-joanne-prod.svc.cluster.local:8092";
  const joanneToken = process.env.JOANNE_ADMIN_TOKEN;
  if (!joanneToken) {
    return NextResponse.json(
      { ok: false, error: "JOANNE_ADMIN_TOKEN not configured" },
      { status: 503 },
    );
  }

  const endpoint = `${joanneURL.replace(/\/$/, "")}/admin/provision-co-channel`;
  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${joanneToken}`,
      },
      body: JSON.stringify({ email }),
      cache: "no-store",
      signal: AbortSignal.timeout(JOANNE_TIMEOUT_MS),
    });
    const text = await upstream.text();
    const parsed = safeJSON(text);
    return NextResponse.json(parsed ?? { ok: upstream.ok, raw: text }, { status: upstream.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json(
      { ok: false, error: `provision proxy failed: ${message}` },
      { status: 502 },
    );
  }
}

function safeJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
