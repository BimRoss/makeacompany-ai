"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type {
  CapabilityCatalog,
  CapabilityCatalogEmployee,
  CapabilityCatalogSkill,
} from "@/lib/admin/catalog";

type LoadState = "idle" | "loading" | "saving" | "error" | "ready";

type EmployeeModalState = { mode: "edit"; index: number } | null;
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

  async function saveCatalog() {
    setState("saving");
    setStatusText("Saving catalog to Redis...");
    try {
      const normalized = normalizeCatalog(catalog);
      const response = await fetch("/api/admin/catalog", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
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

  function saveEmployeeDraft() {
    const draft = normalizeEmployee(employeeDraft);
    if (!draft.id) {
      setStatusText("Employee record is invalid.");
      setState("error");
      return;
    }

    setCatalog((current) => {
      const nextSkillMap: Record<string, string[]> = { ...current.employeeSkillIds };
      if (employeeModal?.mode === "edit" && current.coreEmployees[employeeModal.index]) {
        nextSkillMap[draft.id] = [...new Set(employeeDraft.skillIds.map((id) => id.trim()).filter(Boolean))].sort();
      }
      return {
        ...current,
        employeeSkillIds: nextSkillMap,
      };
    });

    setEmployeeModal(null);
    setState("ready");
    setStatusText("Employee skills updated. Save to Redis when ready.");
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
    setStatusText("Skill draft updated. Save to Redis when ready.");
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
    setStatusText("Skill removed from local draft. Save to Redis when ready.");
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap justify-end gap-2">
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
            <span className="text-xs text-muted-foreground">Managed from Slack catalog</span>
          </div>
          <div className="space-y-2">
            {catalog.coreEmployees.map((employee, index) => (
              <article
                key={`${employee.id}-${index}`}
                className="employees-card-motion rounded-xl border border-border bg-card px-3 pb-1.5 pt-3 shadow-sm motion-colors sm:px-4 sm:pb-2 sm:pt-4 md:cursor-pointer md:hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold tracking-tight text-foreground">{employee.label}</h3>
                  </div>
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{employee.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {(catalog.employeeSkillIds[employee.id] ?? []).map((skillId) => (
                    <span
                      key={`${employee.id}-${skillId}`}
                      className="inline-flex rounded-full border border-foreground/20 bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background"
                    >
                      {skillLabelById.get(skillId) ?? skillId}
                    </span>
                  ))}
                  {(catalog.employeeSkillIds[employee.id] ?? []).length === 0 ? (
                    <span className="text-xs text-muted-foreground">No skills assigned yet.</span>
                  ) : null}
                </div>
                <div className="mt-2 flex justify-start gap-2">
                  <button
                    type="button"
                    onClick={() => openEditEmployeeModal(index)}
                    aria-label={`Manage skills for ${employee.label}`}
                    className="rounded-md border border-border px-2 py-1 text-foreground hover:bg-muted"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              </article>
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
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Skills</h2>
            <button
              type="button"
              onClick={openCreateSkillModal}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
            >
              Add skill
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
                    {(skillEmployeeIdsBySkillId.get(skill.id) ?? [])
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
                <div className="mt-2 flex justify-start gap-2">
                  <button
                    type="button"
                    onClick={() => openEditSkillModal(index)}
                    aria-label={`Edit ${skill.label}`}
                    className="rounded-md border border-border px-2 py-1 text-foreground hover:bg-muted"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSkill(index)}
                    aria-label={`Delete ${skill.label}`}
                    className="rounded-md border border-border px-2 py-1 text-muted-foreground transition-colors md:hover:border-destructive/50 md:hover:bg-destructive/10 md:hover:text-destructive"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
            {catalog.skills.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                No skills yet.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Status: {statusText || "Idle"}</span>
        <span>Employees: {catalog.coreEmployees.length}</span>
        <span>Skills: {catalog.skills.length}</span>
      </div>

      {employeeModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg space-y-3 rounded-xl border border-border bg-card p-4">
            <h3 className="text-base font-semibold text-foreground">Manage employee skills</h3>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ID</span>
              <input
                value={employeeDraft.id}
                readOnly
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground outline-none"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</span>
              <input
                value={employeeDraft.label}
                readOnly
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground outline-none"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</span>
              <textarea
                value={employeeDraft.description}
                readOnly
                className="h-24 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground outline-none"
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
          optionalParams: ["commenters", "ctaText", "ctaUrl", "editors", "viewers"],
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

