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

type HealthPayload = {
  grafanaDashboardUrl?: string | null;
};

type ObservabilityDataContextValue = {
  loading: boolean;
  lastUpdatedAt: string | null;
  adminDashboardUrl: string | null;
};

const ObservabilityDataContext = createContext<ObservabilityDataContextValue | null>(null);

const POLL_INTERVAL_MS = 30_000;

export function ObservabilityDataProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [adminDashboardUrl, setAdminDashboardUrl] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/admin/health", { cache: "no-store" });
        if (kickToLoginForUnauthorizedApi(response.status, "admin")) {
          return;
        }
        const payload = (await response.json()) as HealthPayload;
        if (cancelledRef.current) return;
        setAdminDashboardUrl(payload.grafanaDashboardUrl ?? null);
        setLastUpdatedAt(new Date().toISOString());
      } catch {
        // leave previous state; pulse will stay green on last good fetch
      } finally {
        if (!cancelledRef.current) {
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
      loading,
      lastUpdatedAt,
      adminDashboardUrl,
    }),
    [loading, lastUpdatedAt, adminDashboardUrl]
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
