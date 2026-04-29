import type { AdminCatalogLoadError } from "@/lib/admin/catalog";

const boxClass =
  "rounded-2xl border border-destructive/50 bg-destructive/5 p-6 text-left shadow-sm";

/**
 * Shown when the app could not load the live capability catalog from the Go backend.
 * Silent JSON fallbacks are intentionally not used, so operators see a hard failure.
 */
export function AdminCatalogErrorBanner({ error }: { error: AdminCatalogLoadError }) {
  return (
    <div className={boxClass} role="alert" aria-live="assertive">
      <p className="text-base font-semibold text-foreground">Capability catalog unavailable</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error.message}</p>
      {error.hint ? (
        <p className="mt-3 text-sm leading-relaxed text-foreground/90">
          <span className="font-medium text-foreground">What to check: </span>
          {error.hint}
        </p>
      ) : null}
      {error.attempts.length > 0 ? (
        <ul className="mt-4 space-y-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {error.attempts.map((a) => (
            <li key={`${a.label}-${a.path}`} className="break-words">
              <span className="text-foreground/80">{a.label}</span> —{" "}
              {a.status != null ? (
                <span className="tabular-nums">HTTP {a.status}</span>
              ) : (
                <span>no response</span>
              )}
              {a.detail ? <span className="block pl-0 pt-1 text-[11px] text-muted-foreground/90">{a.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
