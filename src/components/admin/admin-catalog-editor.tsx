"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CapabilityCatalog,
  CapabilityCatalogEmployee,
  CapabilityCatalogSkill,
} from "@/lib/admin/catalog";

type LoadState = "idle" | "loading" | "saving" | "error" | "ready";

type EmployeeModalState = { mode: "create" } | { mode: "edit"; index: number } | null;
type SkillModalState = { mode: "create" } | { mode: "edit"; index: number } | null;
type EmployeeDraft = CapabilityCatalogEmployee & { skillIds: string[] };

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
      setStatusText("");
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
  const [requiredParamInput, setRequiredParamInput] = useState("");
  const [optionalParamInput, setOptionalParamInput] = useState("");
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
    setRequiredParamInput("");
    setOptionalParamInput("");
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
    setRequiredParamInput("");
    setOptionalParamInput("");
    setSkillModal({ mode: "edit", index });
    setConfirmDeleteSkillInline(false);
  }

  function addSkillParam(kind: "required" | "optional", rawValue: string) {
    const nextParams = parseParamsInput(rawValue);
    if (nextParams.length === 0) return;
    setSkillDraft((prev) => {
      const requiredSet = new Set(prev.requiredParams);
      const optionalSet = new Set(prev.optionalParams);
      for (const param of nextParams) {
        if (kind === "required") {
          requiredSet.add(param);
          optionalSet.delete(param);
        } else {
          optionalSet.add(param);
          requiredSet.delete(param);
        }
      }
      return {
        ...prev,
        requiredParams: [...requiredSet].sort(),
        optionalParams: [...optionalSet].sort(),
      };
    });
    if (kind === "required") {
      setRequiredParamInput("");
    } else {
      setOptionalParamInput("");
    }
  }

  function removeSkillParam(kind: "required" | "optional", param: string) {
    setSkillDraft((prev) => ({
      ...prev,
      requiredParams:
        kind === "required" ? prev.requiredParams.filter((value) => value !== param) : [...prev.requiredParams],
      optionalParams:
        kind === "optional" ? prev.optionalParams.filter((value) => value !== param) : [...prev.optionalParams],
    }));
  }

  async function saveSkillDraft() {
    const requiredParams = normalizeSkillParamList(skillDraft.requiredParams ?? []);
    const optionalParams = normalizeSkillParamList(skillDraft.optionalParams ?? []);
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

    if (!draft.id || !draft.label || !draft.description || draft.requiredParams.length === 0) {
      setState("error");
      setStatusText("Skill id, label, description, and required params are required.");
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
        <section className="relative space-y-3 rounded-xl bg-background/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/employees"
              className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              <span>Employees</span>
            </Link>
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

        <section className="relative space-y-3 rounded-xl bg-background/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/skills"
              className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              <span>Skills</span>
            </Link>
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
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium uppercase tracking-wide text-foreground/80">Required</p>
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
                  <div className="flex flex-wrap items-center gap-2 opacity-50">
                    <p className="font-medium uppercase tracking-wide text-foreground/80">Optional</p>
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

      {statusText ? (
        <p className={state === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{statusText}</p>
      ) : null}

      <div className="flex flex-wrap items-end justify-end gap-3">
        <div className="flex items-center gap-2">
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
              {employeeModal.mode === "create" ? "Add employee" : employeeDraft.id}
            </h3>
            {employeeModal.mode === "create" ? (
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ID</span>
                <input
                  value={employeeDraft.id}
                  onChange={(event) => setEmployeeDraft((prev) => ({ ...prev, id: event.target.value }))}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
                />
              </label>
            ) : null}
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
              {skillModal.mode === "create" ? "Add skill" : skillDraft.id}
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Required params</span>
                <div className="flex items-center gap-2">
                  <input
                    value={requiredParamInput}
                    onChange={(event) => setRequiredParamInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addSkillParam("required", requiredParamInput);
                      }
                    }}
                    placeholder="Add required param"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
                  />
                  {requiredParamInput.trim() ? (
                    <button
                      type="button"
                      onClick={() => addSkillParam("required", requiredParamInput)}
                      className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                    >
                      Add
                    </button>
                  ) : null}
                </div>
                <div className="min-h-10 rounded-md border border-border bg-background px-2 py-2">
                  {skillDraft.requiredParams.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {skillDraft.requiredParams.map((param) => (
                        <button
                          key={`required-param-pill-${param}`}
                          type="button"
                          onClick={() => removeSkillParam("required", param)}
                          className="inline-flex items-center gap-1 rounded-full border border-foreground/20 bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background"
                          aria-label={`Remove required param ${param}`}
                        >
                          {param}
                          <span aria-hidden>×</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No required params yet.</p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Optional params</span>
                <div className="flex items-center gap-2">
                  <input
                    value={optionalParamInput}
                    onChange={(event) => setOptionalParamInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addSkillParam("optional", optionalParamInput);
                      }
                    }}
                    placeholder="Add optional param"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
                  />
                  {optionalParamInput.trim() ? (
                    <button
                      type="button"
                      onClick={() => addSkillParam("optional", optionalParamInput)}
                      className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                    >
                      Add
                    </button>
                  ) : null}
                </div>
                <div className="min-h-10 rounded-md border border-border bg-background px-2 py-2">
                  {skillDraft.optionalParams.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {skillDraft.optionalParams.map((param) => (
                        <button
                          key={`optional-param-pill-${param}`}
                          type="button"
                          onClick={() => removeSkillParam("optional", param)}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-muted"
                          aria-label={`Remove optional param ${param}`}
                        >
                          {param}
                          <span aria-hidden>×</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No optional params yet.</p>
                  )}
                </div>
              </div>
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

function parseParamsInput(raw: string): string[] {
  const parsed = normalizeParamsList(raw);
  return normalizeSkillParamList(parsed);
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
    .filter((skill) => skill.id && skill.label && skill.description && skill.requiredParams.length > 0);

  const skillIDs = new Set(normalizedSkills.map((skill) => skill.id));
  const nextEmployeeSkillIDs: Record<string, string[]> = {};
  for (const employeeID of employeeIDs) {
    const mapped = input.employeeSkillIds?.[employeeID] ?? [];
    nextEmployeeSkillIDs[employeeID] = [
      ...new Set(mapped.map((id) => normalizeSkillID(id)).filter((id) => skillIDs.has(id))),
    ].sort();
  }

  const ownersBySkill = new Map<string, string[]>();
  for (const [employeeID, skillIDs] of Object.entries(nextEmployeeSkillIDs)) {
    for (const skillID of skillIDs) {
      const current = ownersBySkill.get(skillID) ?? [];
      current.push(employeeID);
      ownersBySkill.set(skillID, current);
    }
  }
  for (const [skillID, owners] of ownersBySkill.entries()) {
    ownersBySkill.set(skillID, [...new Set(owners)].sort());
  }

  const normalizedSkillsWithDerivedRuntime = normalizedSkills.map((skill) => ({
    ...skill,
    runtimeTool: deriveRuntimeToolValue(skill.runtimeTool, skill.id, ownersBySkill.get(skill.id) ?? []),
  }));

  return {
    coreEmployees: normalizedEmployees,
    skills: normalizedSkillsWithDerivedRuntime,
    employeeSkillIds: nextEmployeeSkillIDs,
    updatedAt: input.updatedAt,
    source: input.source,
  };
}

function deriveRuntimeToolValue(currentRuntimeTool: string, skillID: string, owners: string[]): string {
  const normalizedSkillID = normalizeSkillID(skillID);
  const runtimeTool = (currentRuntimeTool ?? "").trim().toLowerCase();
  if (owners.length > 0) {
    return `${owners[0]}-${normalizedSkillID}`;
  }
  switch (runtimeTool) {
    case "joanne_email":
      return "joanne-write-email";
    case "joanne_google_docs":
      return "joanne-write-doc";
    case "garth_twitter_lookup":
      return "garth-read-twitter";
    case "ross_ops":
      return "ross-ops";
    default:
      return runtimeTool;
  }
}


