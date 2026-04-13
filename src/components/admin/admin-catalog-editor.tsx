"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import skillsSnapshot from "@/data/admin/skills-snapshot.json";
import teamSnapshot from "@/data/admin/team-snapshot.json";
import type {
  CapabilityCatalog,
  CapabilityCatalogEmployee,
  CapabilityCatalogSkill,
} from "@/lib/admin/catalog";

type LoadState = "idle" | "loading" | "saving" | "error" | "ready";

type EmployeeModalState = { mode: "create" } | { mode: "edit"; index: number } | null;
type SkillModalState = { mode: "create" } | { mode: "edit"; index: number } | null;
type EmployeeDraft = CapabilityCatalogEmployee & { skillIds: string[] };
type TeamSnapshotEmployee = {
  id: string;
  displayName?: string;
  botDisplayName?: string;
  shortDescription?: string;
  longDescription?: string;
  skillIds?: string[];
};
type TeamSnapshotData = { employees: TeamSnapshotEmployee[] };
type SkillsSnapshotSkill = { id: string; label?: string; description?: string };
type SkillsSnapshotData = { skills: SkillsSnapshotSkill[] };

const typedTeamSnapshot = teamSnapshot as TeamSnapshotData;
const typedSkillsSnapshot = skillsSnapshot as SkillsSnapshotData;

export function AdminCatalogEditor() {
  const [state, setState] = useState<LoadState>("idle");
  const [statusText, setStatusText] = useState<string>("");
  const [catalog, setCatalog] = useState<CapabilityCatalog>({
    coreEmployees: [],
    skills: [],
    employeeSkillIds: {},
  });

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

  const [employeeModal, setEmployeeModal] = useState<EmployeeModalState>(null);
  const [skillModal, setSkillModal] = useState<SkillModalState>(null);
  const [confirmDeleteSkillInline, setConfirmDeleteSkillInline] = useState(false);
  const [employeeDraft, setEmployeeDraft] = useState<EmployeeDraft>({
    id: "",
    label: "",
    description: "",
    skillIds: [],
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
  const skillLabelById = useMemo(
    () => new Map(catalog.skills.map((skill) => [skill.id, skill.label])),
    [catalog.skills]
  );
  const memberNameById = useMemo(
    () => new Map(catalog.coreEmployees.map((member) => [member.id, member.label])),
    [catalog.coreEmployees]
  );
  const skillEmployeeIdsBySkillId = useMemo(
    () => {
      const out = new Map<string, string[]>();
      for (const [employeeId, skillIds] of Object.entries(catalog.employeeSkillIds)) {
        for (const skillId of skillIds ?? []) {
          const list = out.get(skillId) ?? [];
          list.push(employeeId);
          out.set(skillId, list);
        }
      }
      return out;
    },
    [catalog.employeeSkillIds]
  );
  const employeesSortedBySkillCount = useMemo(
    () =>
      catalog.coreEmployees
        .map((employee, index) => ({
          employee,
          index,
          skillCount: (catalog.employeeSkillIds[employee.id] ?? []).length,
        }))
        .sort((a, b) => {
          if (b.skillCount !== a.skillCount) return b.skillCount - a.skillCount;
          return a.employee.label.localeCompare(b.employee.label);
        }),
    [catalog.coreEmployees, catalog.employeeSkillIds]
  );

  async function logout() {
    try {
      await fetch("/api/admin/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/admin/login";
    }
  }

  async function persistCatalog(next: CapabilityCatalog, successMessage: string) {
    setState("saving");
    setStatusText("Saving catalog to Redis...");
    try {
      const response = await fetch("/api/admin/catalog", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(normalizeCatalog(next)),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        const errorText =
          typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Save failed. Check backend catalog endpoint.";
        setState("error");
        setStatusText(errorText);
        return false;
      }
      setCatalog(normalizeCatalog(payload as CapabilityCatalog));
      setState("ready");
      setStatusText(successMessage);
      return true;
    } catch {
      setState("error");
      setStatusText("Save failed.");
      return false;
    }
  }

  function openEditEmployeeModal(index: number) {
    const employee = catalog.coreEmployees[index];
    if (!employee) return;
    setEmployeeDraft({
      id: employee.id,
      label: employee.label,
      description: employee.description,
      skillIds: [...(catalog.employeeSkillIds[employee.id] ?? [])],
    });
    setEmployeeModal({ mode: "edit", index });
  }

  function openCreateEmployeeModal() {
    setEmployeeDraft({
      id: "",
      label: "",
      description: "",
      skillIds: [],
    });
    setEmployeeModal({ mode: "create" });
  }

  async function saveEmployeeDraft() {
    const draft = normalizeEmployee(employeeDraft);
    if (!draft.id) {
      setStatusText("Employee record is invalid.");
      setState("error");
      return;
    }
    if (!draft.label || !draft.description) {
      setStatusText("Employee id, name, and description are required.");
      setState("error");
      return;
    }

    const nextEmployees = [...catalog.coreEmployees];
    const nextSkillMap: Record<string, string[]> = { ...catalog.employeeSkillIds };
    if (employeeModal?.mode === "edit" && catalog.coreEmployees[employeeModal.index]) {
      nextEmployees[employeeModal.index] = draft;
      nextSkillMap[draft.id] = [...new Set(employeeDraft.skillIds.map((id) => id.trim()).filter(Boolean))].sort();
    } else if (employeeModal?.mode === "create") {
      const duplicateEmployee = nextEmployees.some((employee) => employee.id === draft.id);
      if (duplicateEmployee) {
        setStatusText(`Employee id '${draft.id}' already exists.`);
        setState("error");
        return;
      }
      nextEmployees.push(draft);
      nextSkillMap[draft.id] = [...new Set(employeeDraft.skillIds.map((id) => id.trim()).filter(Boolean))].sort();
    }

    const nextCatalog: CapabilityCatalog = {
      ...catalog,
      coreEmployees: nextEmployees,
      employeeSkillIds: nextSkillMap,
    };
    const success = await persistCatalog(
      nextCatalog,
      employeeModal?.mode === "create" ? "Employee added and synced to Redis." : "Employee updated and synced to Redis."
    );
    if (success) {
      setEmployeeModal(null);
    }
  }

  function toggleEmployeeDraftSkill(skillId: string) {
    setEmployeeDraft((prev) => {
      const exists = prev.skillIds.includes(skillId);
      if (exists) {
        return { ...prev, skillIds: prev.skillIds.filter((id) => id !== skillId) };
      }
      return { ...prev, skillIds: [...prev.skillIds, skillId].sort() };
    });
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
    setConfirmDeleteSkillInline(false);
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
    setConfirmDeleteSkillInline(false);
  }

  async function saveSkillDraft() {
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
      setStatusText("Skill id, label, description, runtime tool, and required params are required.");
      return;
    }

    const replacingIndex = skillModal?.mode === "edit" ? skillModal.index : -1;
    const duplicateIndex = catalog.skills.findIndex((item) => item.id === draft.id);
    if (duplicateIndex !== -1 && duplicateIndex !== replacingIndex) {
      setState("error");
      setStatusText(`Skill id '${draft.id}' already exists.`);
      return;
    }

    const nextSkills = [...catalog.skills];
    let nextSkillMap: Record<string, string[]> = { ...catalog.employeeSkillIds };
    if (skillModal?.mode === "edit") {
      const previousSkillID = nextSkills[skillModal.index]?.id ?? "";
      nextSkills[skillModal.index] = draft;
      if (previousSkillID && previousSkillID !== draft.id) {
        const remapped: Record<string, string[]> = {};
        for (const [employeeID, skillIDs] of Object.entries(catalog.employeeSkillIds)) {
          remapped[employeeID] = (skillIDs ?? []).map((id) => (id === previousSkillID ? draft.id : id));
        }
        nextSkillMap = remapped;
      }
    } else {
      nextSkills.push(draft);
    }

    const nextCatalog: CapabilityCatalog = {
      ...catalog,
      skills: nextSkills,
      employeeSkillIds: nextSkillMap,
    };
    const success = await persistCatalog(nextCatalog, "Skill updated and synced to Redis.");
    if (success) {
      setSkillModal(null);
      setConfirmDeleteSkillInline(false);
    }
  }

  async function syncCatalogFromSlack() {
    const synced = buildCatalogFromSlackSnapshot(catalog);
    await persistCatalog(synced, "Synced from Slack snapshots and saved to Redis.");
  }

  async function confirmDeleteSkill() {
    const index = skillModal?.mode === "edit" ? skillModal.index : -1;
    if (index < 0) return;
    const removed = catalog.skills[index];
    if (!removed) return;
    const nextSkills = catalog.skills.filter((_, i) => i !== index);
    const nextSkillMap: Record<string, string[]> = {};
    for (const [employeeID, skillIDs] of Object.entries(catalog.employeeSkillIds)) {
      nextSkillMap[employeeID] = (skillIDs ?? []).filter((id) => id !== removed.id);
    }
    const nextCatalog: CapabilityCatalog = {
      ...catalog,
      skills: nextSkills,
      employeeSkillIds: nextSkillMap,
    };
    const success = await persistCatalog(nextCatalog, "Skill removed and synced to Redis.");
    if (success) {
      setSkillModal(null);
      setConfirmDeleteSkillInline(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl bg-card px-4 pb-4 pt-0 sm:px-5 sm:pb-5 sm:pt-0">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="relative space-y-3 rounded-xl bg-background/70 p-3 pt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex -mt-2 items-center rounded-md border border-border bg-card px-3 py-2 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Employees</h2>
            </div>
            <button
              type="button"
              onClick={openCreateEmployeeModal}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Add employee
            </button>
          </div>
          <div className="space-y-2">
            {employeesSortedBySkillCount.map(({ employee, index }) => (
              <article
                key={`${employee.id}-${index}`}
                className="employees-card-motion rounded-xl border border-border bg-card px-3 pb-1.5 pt-3 shadow-sm motion-colors sm:px-4 sm:pb-2 sm:pt-4 md:cursor-pointer md:hover:shadow-md"
                role="button"
                tabIndex={0}
                onClick={() => openEditEmployeeModal(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openEditEmployeeModal(index);
                  }
                }}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold tracking-tight text-foreground">{employee.label}</h3>
                    {(catalog.employeeSkillIds[employee.id] ?? []).map((skillId) => (
                      <span
                        key={`${employee.id}-${skillId}-desktop`}
                        className="hidden rounded-full border border-foreground/20 bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background sm:inline-flex"
                      >
                        {skillLabelById.get(skillId) ?? skillId}
                      </span>
                    ))}
                    {(catalog.employeeSkillIds[employee.id] ?? [])[0] ? (
                      <span className="inline-flex rounded-full border border-foreground/20 bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background sm:hidden">
                        {skillLabelById.get((catalog.employeeSkillIds[employee.id] ?? [])[0] ?? "") ??
                          (catalog.employeeSkillIds[employee.id] ?? [])[0]}
                      </span>
                    ) : null}
                    {(catalog.employeeSkillIds[employee.id] ?? []).length > 1 ? (
                      <span className="inline-flex rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:hidden">
                        +{(catalog.employeeSkillIds[employee.id] ?? []).length - 1}
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{employee.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {(catalog.employeeSkillIds[employee.id] ?? []).length === 0 ? (
                    <span className="text-xs text-muted-foreground">No skills assigned yet.</span>
                  ) : null}
                </div>
              </article>
            ))}
            {catalog.coreEmployees.length === 0 ? (
              <p className="rounded-md bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                No employees yet.
              </p>
            ) : null}
          </div>
        </section>

        <section className="relative space-y-3 rounded-xl bg-background/70 p-3 pt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex -mt-2 items-center rounded-md border border-border bg-card px-3 py-2 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Skills</h2>
            </div>
            <button
              type="button"
              onClick={openCreateSkillModal}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Add skill
            </button>
          </div>
          <div className="space-y-2">
            {catalog.skills.map((skill, index) => (
              <article
                key={`${skill.id}-${index}`}
                className="employees-card-motion rounded-xl border border-border bg-card px-3 pb-1.5 pt-3 shadow-sm motion-colors sm:px-4 sm:pb-2 sm:pt-4 md:cursor-pointer md:hover:shadow-md"
                role="button"
                tabIndex={0}
                onClick={() => openEditSkillModal(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openEditSkillModal(index);
                  }
                }}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold tracking-tight text-foreground">{skill.label}</h3>
                    {(skillEmployeeIdsBySkillId.get(skill.id) ?? [])
                      .map((employeeId) => memberNameById.get(employeeId))
                      .filter((name): name is string => Boolean(name))
                      .map((name) => (
                        <span
                          key={`${skill.id}-${name}`}
                          className="inline-flex rounded-full border border-foreground/20 bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background"
                        >
                          {name}
                        </span>
                      ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{skill.id}</p>
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{skill.description}</p>
                <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                  <div className="space-y-1">
                    <p className="font-medium uppercase tracking-wide text-foreground/80">Required</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {skill.requiredParams.length > 0 ? (
                        skill.requiredParams.map((param) => (
                          <span
                            key={`${skill.id}-required-${param}`}
                            className="rounded-full border border-border bg-background px-2 py-0.5"
                          >
                            {param}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium uppercase tracking-wide text-foreground/80">Optional</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {skill.optionalParams.length > 0 ? (
                        skill.optionalParams.map((param) => (
                          <span
                            key={`${skill.id}-optional-${param}`}
                            className="rounded-full border border-border bg-background px-2 py-0.5"
                          >
                            {param}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))}
            {catalog.skills.length === 0 ? (
              <p className="rounded-md bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                No skills yet.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-end justify-end gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void syncCatalogFromSlack()}
            className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={state === "loading" || state === "saving"}
          >
            Sync from Slack
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Admin logout
          </button>
        </div>
      </div>

      {employeeModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg space-y-3 rounded-xl border border-border bg-card p-4">
            <h3 className="text-base font-semibold text-foreground">
              {employeeModal.mode === "create" ? "Add employee" : "Manage employee skills"}
            </h3>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ID</span>
              <input
                value={employeeDraft.id}
                onChange={(event) => setEmployeeDraft((prev) => ({ ...prev, id: event.target.value }))}
                readOnly={employeeModal.mode === "edit"}
                className={
                  employeeModal.mode === "edit"
                    ? "w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground outline-none"
                    : "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</span>
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
                className="h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
              />
            </label>
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Skills</p>
              <div className="flex flex-wrap gap-2">
                {catalog.skills.map((skill) => {
                  const selected = employeeDraft.skillIds.includes(skill.id);
                  return (
                    <button
                      key={`employee-draft-${skill.id}`}
                      type="button"
                      onClick={() => toggleEmployeeDraftSkill(skill.id)}
                      className={
                        selected
                          ? "inline-flex rounded-full border border-foreground/20 bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background"
                          : "inline-flex rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-muted"
                      }
                    >
                      {skill.label}
                    </button>
                  );
                })}
              </div>
              {catalog.skills.length === 0 ? <p className="text-xs text-muted-foreground">No skills available.</p> : null}
            </div>
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
                disabled={state === "saving" || state === "loading"}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {skillModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-xl space-y-3 rounded-xl border border-border bg-card p-4">
            <h3 className="text-base font-semibold text-foreground">
              {skillModal.mode === "create" ? "Add skill" : "Edit skill"}
            </h3>
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
              {skillModal.mode === "edit" ? (
                <div className="mr-auto">
                  {confirmDeleteSkillInline ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5">
                      <span className="text-xs text-destructive">Delete this skill and unassign it from employees?</span>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteSkillInline(false)}
                        className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                        disabled={state === "saving" || state === "loading"}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirmDeleteSkill()}
                        className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:opacity-90"
                        disabled={state === "saving" || state === "loading"}
                      >
                        Confirm delete
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteSkillInline(true)}
                      className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                      disabled={state === "saving" || state === "loading"}
                    >
                      Delete skill
                    </button>
                  )}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setSkillModal(null);
                  setConfirmDeleteSkillInline(false);
                }}
                className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveSkillDraft}
                className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
                disabled={state === "saving" || state === "loading"}
              >
                Save
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

function normalizeSkillID(raw: string): string {
  const id = raw.trim();
  if (id === "write-docs") return "write-doc";
  return id;
}

function normalizeSkillParamName(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (value === "additionalCommenters") return "commenters";
  if (value === "additionalEditors") return "editors";
  if (value === "additionalViewers") return "viewers";
  if (value === "ctaText" || value === "cta_text") return "button";
  if (value === "ctaUrl" || value === "ctaURL" || value === "cta_url") return "link";
  if (value === "bodyText") return "intent";
  if (value === "docType") return "type";
  if (value === "maxResults") return "count";
  if (
    value === "bodyInstruction" ||
    value === "goal" ||
    value === "lengthTarget" ||
    value === "tableRequest" ||
    value === "deadline" ||
    value === "tone" ||
    value === "timeRange" ||
    value === "sortBy"
  ) {
    return "";
  }
  return value;
}

function normalizeSkillParamList(values: string[]): string[] {
  return [...new Set(values.map(normalizeSkillParamName).filter(Boolean))].sort();
}

function normalizeCatalog(input: CapabilityCatalog): CapabilityCatalog {
  const normalizedEmployees = (input.coreEmployees ?? [])
    .map(normalizeEmployee)
    .filter((employee) => employee.id && employee.label && employee.description);

  const employeeIDs = new Set(normalizedEmployees.map((employee) => employee.id));

  const normalizedSkills = (input.skills ?? [])
    .map((skill) => ({
      id: normalizeSkillID(skill.id ?? ""),
      label: skill.label?.trim() ?? "",
      description: skill.description?.trim() ?? "",
      runtimeTool: skill.runtimeTool?.trim().toLowerCase() ?? "",
      requiredParams: normalizeSkillParamList(skill.requiredParams ?? []),
      optionalParams: normalizeSkillParamList(skill.optionalParams ?? []),
    }))
    .map((skill) => {
      if (skill.id === "write-doc") {
        return {
          ...skill,
          label: "Write Doc",
          requiredParams: ["intent", "title", "type"],
          optionalParams: ["commenters", "editors", "viewers"],
        };
      }
      if (skill.id === "write-email") {
        return {
          ...skill,
          requiredParams: ["intent", "subject", "to"],
          optionalParams: ["button", "commenters", "editors", "link", "viewers"],
        };
      }
      if (skill.id === "read-twitter") {
        return {
          ...skill,
          optionalParams: ["count"],
        };
      }
      return skill;
    })
    .filter((skill) => skill.id !== "read-server")
    .map((skill) => {
      const required = [...new Set(skill.requiredParams)].sort();
      const requiredSet = new Set(required);
      const optional = [...new Set(skill.optionalParams.filter((param) => !requiredSet.has(param)))].sort();
      return { ...skill, requiredParams: required, optionalParams: optional };
    })
    .filter((skill) => skill.id && skill.label && skill.description && skill.runtimeTool && skill.requiredParams.length > 0);

  const skillIDs = new Set(normalizedSkills.map((skill) => skill.id));
  const nextEmployeeSkillIDs: Record<string, string[]> = {};
  for (const employeeID of employeeIDs) {
    const mapped = input.employeeSkillIds?.[employeeID] ?? [];
    nextEmployeeSkillIDs[employeeID] = [
      ...new Set(mapped.map((id) => normalizeSkillID(id)).filter((id) => skillIDs.has(id))),
    ].sort();
  }

  return {
    coreEmployees: normalizedEmployees,
    skills: normalizedSkills,
    employeeSkillIds: nextEmployeeSkillIDs,
    updatedAt: input.updatedAt,
    source: input.source,
  };
}

function buildCatalogFromSlackSnapshot(current: CapabilityCatalog): CapabilityCatalog {
  const snapshotEmployees = typedTeamSnapshot.employees ?? [];
  const snapshotSkills = typedSkillsSnapshot.skills ?? [];

  const skillMetaById = new Map(
    snapshotSkills
      .map((skill) => {
        const id = normalizeSkillID(skill.id ?? "");
        if (!id) return null;
        return [id, skill] as const;
      })
      .filter((entry): entry is readonly [string, SkillsSnapshotSkill] => Boolean(entry))
  );

  const normalizedSkills = current.skills.map((skill) => {
    const snapshotSkill = skillMetaById.get(skill.id);
    if (!snapshotSkill) return skill;
    return {
      ...skill,
      label: snapshotSkill.label?.trim() || skill.label,
      description: snapshotSkill.description?.trim() || skill.description,
    };
  });

  const knownSkillIds = new Set(normalizedSkills.map((skill) => skill.id));
  const nextEmployees: CapabilityCatalogEmployee[] = [];
  const nextEmployeeSkillIds: Record<string, string[]> = {};
  const seenEmployeeIds = new Set<string>();

  for (const employee of snapshotEmployees) {
    const id = String(employee.id ?? "").trim().toLowerCase();
    if (!id || seenEmployeeIds.has(id)) continue;
    seenEmployeeIds.add(id);

    const fallback = current.coreEmployees.find((member) => member.id === id);
    const label =
      String(employee.displayName ?? "").trim() ||
      String(employee.botDisplayName ?? "").trim() ||
      fallback?.label ||
      id;
    const description =
      String(employee.longDescription ?? "").trim() ||
      String(employee.shortDescription ?? "").trim() ||
      fallback?.description ||
      "AI teammate";

    nextEmployees.push({ id, label, description });

    const snapshotSkillIds = Array.isArray(employee.skillIds) ? employee.skillIds : [];
    const mergedSkillIds = snapshotSkillIds
      .map((value) => normalizeSkillID(String(value ?? "")))
      .filter((skillId) => Boolean(skillId) && knownSkillIds.has(skillId));
    nextEmployeeSkillIds[id] = [...new Set(mergedSkillIds)].sort();
  }

  for (const employee of current.coreEmployees) {
    const id = String(employee.id ?? "").trim().toLowerCase();
    if (!id || seenEmployeeIds.has(id)) continue;
    seenEmployeeIds.add(id);
    nextEmployees.push(employee);

    const existingSkillIds = current.employeeSkillIds[id] ?? [];
    nextEmployeeSkillIds[id] = [
      ...new Set(
        existingSkillIds
          .map((value) => normalizeSkillID(String(value ?? "")))
          .filter((skillId) => Boolean(skillId) && knownSkillIds.has(skillId))
      ),
    ].sort();
  }

  const next: CapabilityCatalog = {
    ...current,
    coreEmployees: nextEmployees,
    skills: normalizedSkills,
    employeeSkillIds: nextEmployeeSkillIds,
    source: "slack_snapshot_sync",
  };

  return normalizeCatalog(next);
}

