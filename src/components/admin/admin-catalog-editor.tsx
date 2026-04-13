"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AdminSkill,
  CapabilityCatalog,
  CapabilityCatalogEmployee,
  CapabilityCatalogSkill,
  TeamMember,
} from "@/lib/admin/catalog";
import { TeamMemberCard } from "@/components/admin/team-member-card";

type LoadState = "idle" | "loading" | "saving" | "error" | "ready";
type AuthState = "checking" | "ready" | "error";

type EmployeeModalState =
  | { mode: "create" }
  | { mode: "edit"; index: number }
  | null;
type SkillModalState = { mode: "create" } | { mode: "edit"; index: number } | null;

export function AdminCatalogEditor() {
  const [state, setState] = useState<LoadState>("idle");
  const [statusText, setStatusText] = useState<string>("");
  const [catalog, setCatalog] = useState<CapabilityCatalog>({
    coreEmployees: [],
    skills: [],
    employeeSkillIds: {},
  });
  const [adminToken, setAdminToken] = useState<string>("");
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authExpiresAt, setAuthExpiresAt] = useState<string>("");
  const [expiresInSec, setExpiresInSec] = useState<number>(0);

  const redirectToLogin = useCallback((reason: string) => {
    window.location.href = `/admin/login?auth=${encodeURIComponent(reason)}`;
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/auth/me", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { authenticated?: boolean; email?: string; expiresAt?: string }
        | null;
      if (!response.ok || !payload?.authenticated || !payload.email || !payload.expiresAt) {
        setAuthState("error");
        redirectToLogin("expired");
        return;
      }
      setAuthEmail(payload.email);
      setAuthExpiresAt(payload.expiresAt);
      setAuthState("ready");
    } catch {
      setAuthState("error");
      redirectToLogin("expired");
    }
  }, [redirectToLogin]);

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
      setCatalog(normalizeCatalog(payload as CapabilityCatalog));
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

  useEffect(() => {
    void refreshAuth();
    const poll = window.setInterval(() => {
      void refreshAuth();
    }, 60_000);
    return () => {
      window.clearInterval(poll);
    };
  }, [refreshAuth]);

  useEffect(() => {
    if (!authExpiresAt) {
      setExpiresInSec(0);
      return;
    }
    const expiry = new Date(authExpiresAt).getTime();
    if (!Number.isFinite(expiry)) {
      setExpiresInSec(0);
      return;
    }
    const update = () => {
      const sec = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
      setExpiresInSec(sec);
      if (sec <= 0) {
        redirectToLogin("expired");
      }
    };
    update();
    const tick = window.setInterval(update, 1000);
    return () => {
      window.clearInterval(tick);
    };
  }, [authExpiresAt, redirectToLogin]);

  const expiryLabel = useMemo(() => {
    if (!authExpiresAt) {
      return "unknown";
    }
    const d = new Date(authExpiresAt);
    if (Number.isNaN(d.getTime())) {
      return "unknown";
    }
    return d.toLocaleString();
  }, [authExpiresAt]);

  const expiresInLabel = useMemo(() => {
    const hours = Math.floor(expiresInSec / 3600);
    const mins = Math.floor((expiresInSec % 3600) / 60);
    const secs = expiresInSec % 60;
    return `${hours}h ${mins}m ${secs}s`;
  }, [expiresInSec]);

  const [employeeModal, setEmployeeModal] = useState<EmployeeModalState>(null);
  const [skillModal, setSkillModal] = useState<SkillModalState>(null);
  const [employeeDraft, setEmployeeDraft] = useState<CapabilityCatalogEmployee>({
    id: "",
    label: "",
    description: "",
  });
  const [skillDraft, setSkillDraft] = useState<CapabilityCatalogSkill>({
    id: "",
    label: "",
    description: "",
    runtimeTool: "",
    requiredParams: [],
    optionalParams: [],
  });
  const [requiredParamsInput, setRequiredParamsInput] = useState("");
  const [optionalParamsInput, setOptionalParamsInput] = useState("");
  const previewData = useMemo(() => catalogToPreviewData(catalog), [catalog]);
  const previewMemberById = useMemo(
    () => new Map(previewData.members.map((member) => [member.id, member])),
    [previewData.members]
  );
  const previewSkillById = useMemo(
    () => new Map(previewData.skills.map((skill) => [skill.id, skill])),
    [previewData.skills]
  );
  const memberNameById = useMemo(
    () => new Map(previewData.members.map((member) => [member.id, member.displayName])),
    [previewData.members]
  );

  async function saveCatalog() {
    setState("saving");
    setStatusText("Saving catalog to Redis...");
    try {
      const normalized = normalizeCatalog(catalog);
      const response = await fetch("/api/admin/catalog", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(adminToken.trim() ? { "X-Admin-Token": adminToken.trim() } : {}),
        },
        body: JSON.stringify(normalized),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        setState("error");
        const errorText =
          typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Save failed. Check token and payload shape.";
        setStatusText(errorText);
        return;
      }
      setCatalog(normalizeCatalog(payload as CapabilityCatalog));
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

  function openCreateEmployeeModal() {
    setEmployeeDraft({ id: "", label: "", description: "" });
    setEmployeeModal({ mode: "create" });
  }

  function openEditEmployeeModal(index: number) {
    const employee = catalog.coreEmployees[index];
    if (!employee) return;
    setEmployeeDraft({
      id: employee.id,
      label: employee.label,
      description: employee.description,
    });
    setEmployeeModal({ mode: "edit", index });
  }

  function saveEmployeeDraft() {
    const draft = normalizeEmployee(employeeDraft);
    if (!draft.id || !draft.label || !draft.description) {
      setStatusText("Employee id, label, and description are required.");
      setState("error");
      return;
    }
    const replacingIndex = employeeModal?.mode === "edit" ? employeeModal.index : -1;
    const duplicateIndex = catalog.coreEmployees.findIndex((item) => item.id === draft.id);
    if (duplicateIndex !== -1 && duplicateIndex !== replacingIndex) {
      setState("error");
      setStatusText(`Employee id '${draft.id}' already exists.`);
      return;
    }

    setCatalog((current) => {
      const nextEmployees = [...current.coreEmployees];

      if (employeeModal?.mode === "edit") {
        nextEmployees[employeeModal.index] = draft;
      } else {
        nextEmployees.push(draft);
      }

      const nextSkillMap: Record<string, string[]> = {};
      for (const employee of nextEmployees) {
        nextSkillMap[employee.id] = current.employeeSkillIds[employee.id] ?? [];
      }
      return {
        ...current,
        coreEmployees: nextEmployees,
        employeeSkillIds: nextSkillMap,
      };
    });

    setEmployeeModal(null);
    setState("ready");
    setStatusText("Employee draft updated. Save to Redis when ready.");
  }

  function deleteEmployee(index: number) {
    setCatalog((current) => {
      const removed = current.coreEmployees[index];
      if (!removed) return current;
      const nextEmployees = current.coreEmployees.filter((_, i) => i !== index);
      const nextSkillMap: Record<string, string[]> = {};
      for (const employee of nextEmployees) {
        nextSkillMap[employee.id] = current.employeeSkillIds[employee.id] ?? [];
      }
      return {
        ...current,
        coreEmployees: nextEmployees,
        employeeSkillIds: nextSkillMap,
      };
    });
    setState("ready");
    setStatusText("Employee removed from local draft. Save to Redis when ready.");
  }

  function openCreateSkillModal() {
    setSkillDraft({
      id: "",
      label: "",
      description: "",
      runtimeTool: "",
      requiredParams: [],
      optionalParams: [],
    });
    setRequiredParamsInput("");
    setOptionalParamsInput("");
    setSkillModal({ mode: "create" });
  }

  function openEditSkillModal(index: number) {
    const skill = catalog.skills[index];
    if (!skill) return;
    setSkillDraft({
      id: skill.id,
      label: skill.label,
      description: skill.description,
      runtimeTool: skill.runtimeTool,
      requiredParams: [...(skill.requiredParams ?? [])],
      optionalParams: [...(skill.optionalParams ?? [])],
    });
    setRequiredParamsInput((skill.requiredParams ?? []).join(", "));
    setOptionalParamsInput((skill.optionalParams ?? []).join(", "));
    setSkillModal({ mode: "edit", index });
  }

  function saveSkillDraft() {
    const requiredParams = normalizeParamsList(requiredParamsInput);
    const optionalParams = normalizeParamsList(optionalParamsInput);
    const overlap = new Set(requiredParams);
    if (optionalParams.some((value) => overlap.has(value))) {
      setState("error");
      setStatusText("A parameter cannot be both required and optional.");
      return;
    }

    const draft: CapabilityCatalogSkill = {
      id: skillDraft.id.trim(),
      label: skillDraft.label.trim(),
      description: skillDraft.description.trim(),
      runtimeTool: skillDraft.runtimeTool.trim().toLowerCase(),
      requiredParams,
      optionalParams,
    };

    if (!draft.id || !draft.label || !draft.description || !draft.runtimeTool || draft.requiredParams.length === 0) {
      setState("error");
      setStatusText("Tool id, label, description, runtime tool, and required params are required.");
      return;
    }

    const replacingIndex = skillModal?.mode === "edit" ? skillModal.index : -1;
    const duplicateIndex = catalog.skills.findIndex((item) => item.id === draft.id);
    if (duplicateIndex !== -1 && duplicateIndex !== replacingIndex) {
      setState("error");
      setStatusText(`Tool id '${draft.id}' already exists.`);
      return;
    }

    setCatalog((current) => {
      const nextSkills = [...current.skills];

      if (skillModal?.mode === "edit") {
        const previousSkillID = nextSkills[skillModal.index]?.id ?? "";
        nextSkills[skillModal.index] = draft;
        if (previousSkillID && previousSkillID !== draft.id) {
          const nextSkillMap: Record<string, string[]> = {};
          for (const [employeeID, skillIDs] of Object.entries(current.employeeSkillIds)) {
            nextSkillMap[employeeID] = (skillIDs ?? []).map((id) => (id === previousSkillID ? draft.id : id));
          }
          return { ...current, skills: nextSkills, employeeSkillIds: nextSkillMap };
        }
      } else {
        nextSkills.push(draft);
      }

      return { ...current, skills: nextSkills };
    });

    setSkillModal(null);
    setState("ready");
    setStatusText("Tool draft updated. Save to Redis when ready.");
  }

  function deleteSkill(index: number) {
    setCatalog((current) => {
      const removed = current.skills[index];
      if (!removed) return current;
      const nextSkills = current.skills.filter((_, i) => i !== index);
      const nextSkillMap: Record<string, string[]> = {};
      for (const [employeeID, skillIDs] of Object.entries(current.employeeSkillIds)) {
        nextSkillMap[employeeID] = (skillIDs ?? []).filter((id) => id !== removed.id);
      }
      return {
        ...current,
        skills: nextSkills,
        employeeSkillIds: nextSkillMap,
      };
    });
    setState("ready");
    setStatusText("Tool removed from local draft. Save to Redis when ready.");
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Catalog Admin</h1>
        <p className="text-sm text-muted-foreground">
          Manage employees and tools in a card view. Save when you are ready to persist to Redis.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground">
          Auth: {authState === "checking" ? "checking..." : authState === "ready" ? "active" : "expired"}
        </span>
        {authEmail ? (
          <span className="rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground">
            {authEmail}
          </span>
        ) : null}
        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground">
          Expires in: {expiresInLabel}
        </span>
        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground">
          Expires at: {expiryLabel}
        </span>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-border bg-background p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Employees</h2>
            <button
              type="button"
              onClick={openCreateEmployeeModal}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
            >
              Add employee
            </button>
          </div>
          <div className="space-y-2">
            {catalog.coreEmployees.map((employee, index) => (
              <section
                key={`${employee.id}-${index}`}
                className="rounded-xl border border-border bg-card p-2"
              >
                {previewMemberById.get(employee.id) ? (
                  <TeamMemberCard
                    member={previewMemberById.get(employee.id)!}
                    skillsById={previewSkillById}
                    className="border-none bg-transparent p-2 shadow-none md:hover:translate-y-0 md:hover:shadow-none"
                  />
                ) : null}
                <div className="mt-1 flex justify-end gap-2 px-2 pb-2">
                  <button
                    type="button"
                    onClick={() => openEditEmployeeModal(index)}
                    className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteEmployee(index)}
                    className="rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                  >
                    Delete
                  </button>
                </div>
              </section>
            ))}
            {catalog.coreEmployees.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                No employees yet.
              </p>
            ) : null}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-background p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tools</h2>
            <button
              type="button"
              onClick={openCreateSkillModal}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
            >
              Add tool
            </button>
          </div>
          <div className="space-y-2">
            {catalog.skills.map((skill, index) => (
              <article
                key={`${skill.id}-${index}`}
                className="employees-card-motion rounded-xl border border-border bg-card px-3 pb-1.5 pt-3 shadow-sm motion-colors sm:px-4 sm:pb-2 sm:pt-4 md:cursor-pointer md:hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold tracking-tight text-foreground">{skill.label}</h3>
                    <p className="text-xs text-muted-foreground">{skill.id}</p>
                  </div>
                  <ul className="flex flex-wrap justify-end gap-1">
                    {(previewData.skills.find((item) => item.id === skill.id)?.employeeIds ?? [])
                      .map((employeeId) => memberNameById.get(employeeId))
                      .filter((name): name is string => Boolean(name))
                      .map((name) => (
                        <li key={`${skill.id}-${name}`}>
                          <span className="inline-flex rounded-full border border-foreground/20 bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background">
                            {name}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{skill.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border border-border bg-background px-2 py-0.5">
                    runtime: {skill.runtimeTool}
                  </span>
                  <span className="rounded-full border border-border bg-background px-2 py-0.5">
                    required: {skill.requiredParams.length}
                  </span>
                  <span className="rounded-full border border-border bg-background px-2 py-0.5">
                    optional: {skill.optionalParams.length}
                  </span>
                </div>
                <div className="mt-2 flex justify-end gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEditSkillModal(index)}
                      className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSkill(index)}
                      className="rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {catalog.skills.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                No tools yet.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Status: {statusText || "Idle"}</span>
        <span>Employees: {catalog.coreEmployees.length}</span>
        <span>Tools: {catalog.skills.length}</span>
      </div>

      {employeeModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">
                {employeeModal.mode === "create" ? "Add employee" : "Edit employee"}
              </h3>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                onClick={() => setEmployeeModal(null)}
              >
                Close
              </button>
            </div>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ID</span>
              <input
                value={employeeDraft.id}
                onChange={(event) => setEmployeeDraft((prev) => ({ ...prev, id: event.target.value }))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Label</span>
              <input
                value={employeeDraft.label}
                onChange={(event) => setEmployeeDraft((prev) => ({ ...prev, label: event.target.value }))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</span>
              <textarea
                value={employeeDraft.description}
                onChange={(event) => setEmployeeDraft((prev) => ({ ...prev, description: event.target.value }))}
                className="h-28 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEmployeeModal(null)}
                className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEmployeeDraft}
                className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
              >
                Save draft
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {skillModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-xl space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">
                {skillModal.mode === "create" ? "Add tool" : "Edit tool"}
              </h3>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                onClick={() => setSkillModal(null)}
              >
                Close
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ID</span>
                <input
                  value={skillDraft.id}
                  onChange={(event) => setSkillDraft((prev) => ({ ...prev, id: event.target.value }))}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Label</span>
                <input
                  value={skillDraft.label}
                  onChange={(event) => setSkillDraft((prev) => ({ ...prev, label: event.target.value }))}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
                />
              </label>
            </div>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</span>
              <textarea
                value={skillDraft.description}
                onChange={(event) => setSkillDraft((prev) => ({ ...prev, description: event.target.value }))}
                className="h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Runtime tool</span>
              <input
                value={skillDraft.runtimeTool}
                onChange={(event) => setSkillDraft((prev) => ({ ...prev, runtimeTool: event.target.value }))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Required params (comma separated)
                </span>
                <input
                  value={requiredParamsInput}
                  onChange={(event) => setRequiredParamsInput(event.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Optional params (comma separated)
                </span>
                <input
                  value={optionalParamsInput}
                  onChange={(event) => setOptionalParamsInput(event.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSkillModal(null)}
                className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveSkillDraft}
                className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
              >
                Save draft
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function normalizeEmployee(employee: CapabilityCatalogEmployee): CapabilityCatalogEmployee {
  return {
    id: employee.id.trim().toLowerCase(),
    label: employee.label.trim(),
    description: employee.description.trim(),
  };
}

function normalizeParamsList(raw: string): string[] {
  const parts = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(parts)].sort();
}

function normalizeCatalog(input: CapabilityCatalog): CapabilityCatalog {
  const normalizedEmployees = (input.coreEmployees ?? [])
    .map(normalizeEmployee)
    .filter((employee) => employee.id && employee.label && employee.description);

  const employeeIDs = new Set(normalizedEmployees.map((employee) => employee.id));

  const normalizedSkills = (input.skills ?? [])
    .map((skill) => ({
      id: skill.id?.trim() ?? "",
      label: skill.label?.trim() ?? "",
      description: skill.description?.trim() ?? "",
      runtimeTool: skill.runtimeTool?.trim().toLowerCase() ?? "",
      requiredParams: [...new Set((skill.requiredParams ?? []).map((value) => value.trim()).filter(Boolean))].sort(),
      optionalParams: [...new Set((skill.optionalParams ?? []).map((value) => value.trim()).filter(Boolean))].sort(),
    }))
    .filter((skill) => skill.id && skill.label && skill.description && skill.runtimeTool && skill.requiredParams.length > 0);

  const skillIDs = new Set(normalizedSkills.map((skill) => skill.id));
  const nextEmployeeSkillIDs: Record<string, string[]> = {};
  for (const employeeID of employeeIDs) {
    const mapped = input.employeeSkillIds?.[employeeID] ?? [];
    nextEmployeeSkillIDs[employeeID] = [...new Set(mapped.map((id) => id.trim()).filter((id) => skillIDs.has(id)))].sort();
  }

  return {
    coreEmployees: normalizedEmployees,
    skills: normalizedSkills,
    employeeSkillIds: nextEmployeeSkillIDs,
    updatedAt: input.updatedAt,
    source: input.source,
  };
}

function catalogToPreviewData(input: CapabilityCatalog): { members: TeamMember[]; skills: AdminSkill[] } {
  const members: TeamMember[] = input.coreEmployees.map((employee) => {
    const employeeID = employee.id.trim().toLowerCase();
    const roleTitle = roleTitleForEmployee(employeeID);
    const skillIds = [...(input.employeeSkillIds[employeeID] ?? [])];
    return {
      id: employeeID,
      displayName: employee.label,
      botDisplayName: employee.label,
      lane: "general",
      roleTitle,
      shortDescription: employee.description,
      longDescription: employee.description,
      backgroundColor: "#000000",
      status: "active",
      sourceManifest: "redis:makeacompany:catalog",
      skillIds,
    };
  });

  const skillEmployeeMap = new Map<string, string[]>();
  for (const member of members) {
    for (const skillID of member.skillIds) {
      const list = skillEmployeeMap.get(skillID) ?? [];
      list.push(member.id);
      skillEmployeeMap.set(skillID, list);
    }
  }

  const skills: AdminSkill[] = input.skills.map((skill) => ({
    id: skill.id,
    label: skill.label,
    description: skill.description,
    employeeIds: skillEmployeeMap.get(skill.id) ?? [],
  }));

  return { members, skills };
}

function roleTitleForEmployee(employeeID: string): string {
  switch (employeeID) {
    case "alex":
      return "Head of Sales";
    case "tim":
      return "Head of Simplifying";
    case "ross":
      return "Head of Automation";
    case "garth":
      return "Head of Interns";
    case "joanne":
      return "Head of Executive Operations";
    default:
      return "AI Employee";
  }
}
