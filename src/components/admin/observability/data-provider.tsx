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

import { isBrowserLoopbackHost } from "@/lib/admin/browser-loopback";
import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

export type GrafanaEmbed = {
  key: string;
  panelId: string;
  title: string;
  dashboardUrl: string | null;
  defaultFrom?: string;
};

type HealthPayload = {
  adminGrafanaEmbeds?: GrafanaEmbed[];
  cronjobGrafanaEmbeds?: GrafanaEmbed[];
  grafanaDashboardUrl?: string | null;
  cronjobGrafanaDashboardUrl?: string | null;
};

type ObservabilityDataContextValue = {
  loopback: boolean | null;
  fetched: boolean;
  loading: boolean;
  lastUpdatedAt: string | null;
  adminEmbeds: GrafanaEmbed[];
  cronjobEmbeds: GrafanaEmbed[];
  adminDashboardUrl: string | null;
  cronjobDashboardUrl: string | null;
};

const ObservabilityDataContext = createContext<ObservabilityDataContextValue | null>(null);

const POLL_INTERVAL_MS = 30_000;

export function ObservabilityDataProvider({ children }: { children: ReactNode }) {
  const [loopback, setLoopback] = useState<boolean | null>(null);
  const [fetched, setFetched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [adminEmbeds, setAdminEmbeds] = useState<GrafanaEmbed[]>([]);
  const [cronjobEmbeds, setCronjobEmbeds] = useState<GrafanaEmbed[]>([]);
  const [adminDashboardUrl, setAdminDashboardUrl] = useState<string | null>(null);
  const [cronjobDashboardUrl, setCronjobDashboardUrl] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setLoopback(isBrowserLoopbackHost());

    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/admin/health", { cache: "no-store" });
        if (kickToLoginForUnauthorizedApi(response.status, "admin")) {
          return;
        }
        const payload = (await response.json()) as HealthPayload;
        if (cancelledRef.current) return;
        setAdminEmbeds(Array.isArray(payload.adminGrafanaEmbeds) ? payload.adminGrafanaEmbeds : []);
        setCronjobEmbeds(
          Array.isArray(payload.cronjobGrafanaEmbeds) ? payload.cronjobGrafanaEmbeds : []
        );
        setAdminDashboardUrl(payload.grafanaDashboardUrl ?? null);
        setCronjobDashboardUrl(payload.cronjobGrafanaDashboardUrl ?? null);
        setLastUpdatedAt(new Date().toISOString());
      } catch {
        // leave previous state; pulse will stay green on last good fetch
      } finally {
        if (!cancelledRef.current) {
          setFetched(true);
          setLoading(false);
        }
      }
    };

    void load();
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, []);

  const value = useMemo<ObservabilityDataContextValue>(
    () => ({
      loopback,
      fetched,
      loading,
      lastUpdatedAt,
      adminEmbeds,
      cronjobEmbeds,
      adminDashboardUrl,
      cronjobDashboardUrl,
    }),
    [
      loopback,
      fetched,
      loading,
      lastUpdatedAt,
      adminEmbeds,
      cronjobEmbeds,
      adminDashboardUrl,
      cronjobDashboardUrl,
    ]
  );

  return (
    <ObservabilityDataContext.Provider value={value}>{children}</ObservabilityDataContext.Provider>
  );
}

export function useObservabilityData(): ObservabilityDataContextValue {
  const ctx = useContext(ObservabilityDataContext);
  if (!ctx) {
    throw new Error("useObservabilityData must be used inside <ObservabilityDataProvider>");
  }
  return ctx;
}
