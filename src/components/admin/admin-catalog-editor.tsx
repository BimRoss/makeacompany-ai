"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type LoadState = "idle" | "loading" | "saving" | "error" | "ready";

const emptyCatalogTemplate = `{
  "coreEmployees": [],
  "skills": [],
  "employeeSkillIds": {}
}`;

export function AdminCatalogEditor() {
  const [state, setState] = useState<LoadState>("idle");
  const [statusText, setStatusText] = useState<string>("");
  const [catalogJSON, setCatalogJSON] = useState<string>(emptyCatalogTemplate);
  const [adminToken, setAdminToken] = useState<string>("");

  const loadCatalog = useCallback(async () => {
    setState("loading");
    setStatusText("Loading catalog from Redis...");
    try {
      const response = await fetch("/api/admin/catalog", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        setState("error");
        setStatusText("Failed to load catalog.");
        return;
      }
      setCatalogJSON(`${JSON.stringify(payload, null, 2)}\n`);
      setState("ready");
      setStatusText("Catalog loaded.");
    } catch {
      setState("error");
      setStatusText("Failed to load catalog.");
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const parsedPreview = useMemo(() => {
    try {
      const parsed = JSON.parse(catalogJSON) as {
        coreEmployees?: unknown[];
        skills?: unknown[];
      };
      return {
        valid: true,
        employees: Array.isArray(parsed.coreEmployees) ? parsed.coreEmployees.length : 0,
        skills: Array.isArray(parsed.skills) ? parsed.skills.length : 0,
      };
    } catch {
      return { valid: false, employees: 0, skills: 0 };
    }
  }, [catalogJSON]);

  async function saveCatalog() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(catalogJSON);
    } catch {
      setState("error");
      setStatusText("Invalid JSON. Fix formatting before saving.");
      return;
    }

    setState("saving");
    setStatusText("Saving catalog to Redis...");
    try {
      const response = await fetch("/api/admin/catalog", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(adminToken.trim() ? { "X-Admin-Token": adminToken.trim() } : {}),
        },
        body: JSON.stringify(parsed),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        setState("error");
        setStatusText("Save failed. Check token and payload shape.");
        return;
      }
      setCatalogJSON(`${JSON.stringify(payload, null, 2)}\n`);
      setState("ready");
      setStatusText("Catalog saved to Redis.");
    } catch {
      setState("error");
      setStatusText("Save failed.");
    }
  }

  async function logout() {
    try {
      await fetch("/api/admin/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/admin/login";
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Catalog Admin</h1>
        <p className="text-sm text-muted-foreground">
          Edit the shared employee/tool catalog stored in Redis (`makeacompany:catalog:capabilities:v1`).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <label className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Admin token (optional)
          </span>
          <input
            type="password"
            value={adminToken}
            onChange={(event) => setAdminToken(event.target.value)}
            placeholder="X-Admin-Token value"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-0 placeholder:text-muted-foreground focus:border-foreground/40"
          />
        </label>
        <button
          type="button"
          onClick={() => void loadCatalog()}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          disabled={state === "loading" || state === "saving"}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => void saveCatalog()}
          className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={state === "loading" || state === "saving"}
        >
          Save to Redis
        </button>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          Logout
        </button>
      </div>

      <div className="space-y-2">
        <textarea
          value={catalogJSON}
          onChange={(event) => setCatalogJSON(event.target.value)}
          spellCheck={false}
          className="h-[480px] w-full rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 text-foreground outline-none ring-0 focus:border-foreground/40"
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Status: {statusText || "Idle"}</span>
          <span>JSON: {parsedPreview.valid ? "valid" : "invalid"}</span>
          <span>Employees: {parsedPreview.employees}</span>
          <span>Skills: {parsedPreview.skills}</span>
        </div>
      </div>
    </section>
  );
}
