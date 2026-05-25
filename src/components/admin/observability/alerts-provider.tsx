"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

export type AdminAlert = {
  name: string;
  state: "firing" | "pending" | "inactive";
  severity: string;
  component: string;
  summary: string;
  description: string;
  activeAt: string | null;
  labels: Record<string, string>;
};

type AlertsContextValue = {
  fetched: boolean;
  alerts: AdminAlert[];
  /** Alerts in `firing` state only. */
  firing: AdminAlert[];
  /** Index of firing-alert names keyed by component (web, jobs, cluster) for badge lookup. */
  firingByComponent: Record<string, AdminAlert[]>;
};

const AlertsContext = createContext<AlertsContextValue | null>(null);

const POLL_INTERVAL_MS = 30_000;

export function AlertsProvider({ children }: { children: ReactNode }) {
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [fetched, setFetched] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/prom-alerts", { cache: "no-store" });
        if (kickToLoginForUnauthorizedApi(response.status, "admin")) return;
        if (!response.ok) return;
        const payload = (await response.json()) as { alerts?: AdminAlert[] };
        if (cancelledRef.current) return;
        setAlerts(Array.isArray(payload.alerts) ? payload.alerts : []);
      } catch {
        // keep stale data; UI shows the staleness via the toolbar pulse
      } finally {
        if (!cancelledRef.current) setFetched(true);
      }
    };
    void load();
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, []);

  const value = useMemo<AlertsContextValue>(() => {
    const firing = alerts.filter((a) => a.state === "firing");
    const firingByComponent: Record<string, AdminAlert[]> = {};
    for (const alert of firing) {
      const key = alert.component || "other";
      if (!firingByComponent[key]) firingByComponent[key] = [];
      firingByComponent[key].push(alert);
    }
    return { fetched, alerts, firing, firingByComponent };
  }, [alerts, fetched]);

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts(): AlertsContextValue {
  const ctx = useContext(AlertsContext);
  if (!ctx) {
    return { fetched: false, alerts: [], firing: [], firingByComponent: {} };
  }
  return ctx;
}
