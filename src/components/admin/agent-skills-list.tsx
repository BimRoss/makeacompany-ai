import type { AgentSkill, AgentSkillsResult } from "@/lib/admin/agent-skills";

type AgentSkillsListProps = {
  result: AgentSkillsResult;
  /** When true, render with the heavier admin section heading; otherwise rely on the parent page heading. */
  withHeading?: boolean;
};

const sectionId = "agent-skills-mcp-heading";

/**
 * Read-only list of markdown-backed Agent Skills served by skills-mcp-server
 * (frontmatter + instructions in that repo).
 */
export function AgentSkillsList({ result, withHeading = true }: AgentSkillsListProps) {
  const skills = result.ok ? result.skills : [];
  const source = result.ok ? result.source : "";

  return (
    <section className="space-y-3" aria-labelledby={sectionId}>
      {withHeading ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2
            id={sectionId}
            className="text-lg font-semibold leading-snug tracking-tight"
          >
            Agent Skills{" "}
            <span className="font-normal text-muted-foreground tabular-nums">
              ({skills.length})
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Read-only · sourced from{" "}
            <span className="font-mono">skills-mcp-server</span>
            {source ? <span className="ml-1 opacity-60">({source})</span> : null}
          </p>
        </div>
      ) : null}

      {!result.ok ? (
        <div
          className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-950 dark:text-amber-100"
          role="status"
        >
          <p className="font-medium">Agent skills unavailable.</p>
          <p className="mt-1 text-amber-950/80 dark:text-amber-100/80">
            {result.error}
          </p>
          <p className="mt-2 text-xs text-amber-950/70 dark:text-amber-100/70">
            Set <span className="font-mono">SKILLS_MCP_BASE_URL</span> on the
            backend to a reachable skills-mcp-server (e.g.{" "}
            <span className="font-mono">http://skills-mcp-server:8081</span> in
            the local Docker stack).
          </p>
        </div>
      ) : skills.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-base font-medium text-foreground">
            No agent skills found.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            skills-mcp-server returned an empty list. Seed it via the MCP{" "}
            <span className="font-mono">create_skill</span> tool or by writing
            files into its <span className="font-mono">SKILLS_MCP_SERVER_DIR</span>.
          </p>
        </div>
      ) : (
        <div className="columns-1 gap-x-3 sm:columns-2 xl:columns-3 [column-fill:balance]">
          {skills.map((skill) => (
            <AgentSkillCard key={skill.name} skill={skill} />
          ))}
        </div>
      )}
    </section>
  );
}

/** First two newline-separated lines of the description; ellipsis when more remains (caller renders …). */
function twoLineDescriptionPreview(description: string): { text: string; truncated: boolean } | null {
  const trimmed = description.trimEnd();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/);
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  const logical = lines.slice(0, end);
  if (logical.length <= 2) {
    return { text: logical.join("\n"), truncated: false };
  }
  return { text: logical.slice(0, 2).join("\n"), truncated: true };
}

function AgentSkillCard({ skill }: { skill: AgentSkill }) {
  const allowedTools = (skill.allowedTools ?? "").trim();
  const allowedToolsList = allowedTools
    ? allowedTools
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  const meta = skill.metadata ?? {};
  const kind = String(meta.kind ?? "").trim();
  const execution = String(meta.execution ?? "").trim();

  const metadataEntries = Object.entries(meta)
    .map(([k, v]) => [String(k).trim(), String(v ?? "").trim()] as const)
    .filter(([k, v]) => k.length > 0 && v.length > 0 && k !== "kind" && k !== "execution");

  const descriptionPreview = skill.description ? twoLineDescriptionPreview(skill.description) : null;

  return (
    <article className="employees-card-motion mb-3 flex w-full flex-col gap-1.5 break-inside-avoid rounded-lg border border-border bg-card p-3 shadow-sm motion-colors">
      <h3 className="text-base font-semibold leading-tight tracking-tight text-foreground">
        {skill.name}
      </h3>

      {descriptionPreview ? (
        <p className="min-w-0 whitespace-pre-line text-sm leading-snug text-muted-foreground">
          {descriptionPreview.text}
          {descriptionPreview.truncated ? "…" : null}
        </p>
      ) : null}

      {kind || execution ? (
        <dl className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {kind ? (
            <div className="flex min-w-0 gap-1">
              <dt className="shrink-0 font-mono opacity-70">kind</dt>
              <dd className="min-w-0 break-words">{kind}</dd>
            </div>
          ) : null}
          {execution ? (
            <div className="flex min-w-0 gap-1">
              <dt className="shrink-0 font-mono opacity-70">execution</dt>
              <dd className="min-w-0 break-words">{execution}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {allowedToolsList.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {allowedToolsList.map((tool) => (
            <span
              key={`${skill.name}-tool-${tool}`}
              className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {tool}
            </span>
          ))}
        </div>
      ) : null}

      {metadataEntries.length > 0 ? (
        <dl className="mt-1 grid grid-cols-1 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {metadataEntries.map(([key, value]) => (
            <div key={`${skill.name}-meta-${key}`} className="flex gap-1">
              <dt className="font-mono opacity-70">{key}:</dt>
              <dd className="min-w-0 truncate">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {skill.updatedAt ? (
        <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Updated {formatUpdatedAt(skill.updatedAt)}
        </p>
      ) : null}
    </article>
  );
}

function formatUpdatedAt(value: string): string {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return value;
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
