"use client";

import { useEffect, useState } from "react";

import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

export type SyntheticCheck = {
  name: string;
  ok: boolean;
  latencyMs: number;
  error: string | null;
};

export type SyntheticProbeState = {
  ok: boolean | null;
  checks: SyntheticCheck[];
  checkedAt: string | null;
};

const POLL_INTERVAL_MS = 60_000;

export function useSyntheticProbe(): SyntheticProbeState {
  const [state, setState] = useState<SyntheticProbeState>({
    ok: null,
    checks: [],
    checkedAt: null,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/synthetic-probe", { cache: "no-store" });
        if (kickToLoginForUnauthorizedApi(response.status, "admin")) return;
        if (!response.ok) return;
        const payload = (await response.json()) as Partial<SyntheticProbeState>;
        if (cancelled) return;
        setState({
          ok: typeof payload.ok === "boolean" ? payload.ok : null,
          checks: Array.isArray(payload.checks) ? payload.checks : [],
          checkedAt: payload.checkedAt ?? null,
        });
      } catch {
        // leave previous state — staleness shows via checkedAt
      }
    };
    void load();
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return state;
}
