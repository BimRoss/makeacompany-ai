/** Shared value formatters for native observability panels. */

export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(abs % 1 === 0 ? 0 : 1);
  if (abs === 0) return "0";
  return n.toFixed(abs < 1 ? 2 : 1);
}

export function formatMs(seconds: number): string {
  const ms = seconds * 1000;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(0)}ms`;
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(ratio >= 0.999 ? 2 : 1)}%`;
}

export function formatPerMin(n: number): string {
  return `${formatCompact(n)}/min`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(0)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** Days-scale duration used by the TTFV panel. Falls back to hours/minutes
 * under a day so a same-day TTFV reads as "8h" rather than "0.3d".
 * Returns "<1h" for zero-second values: the backend clamps negative TTFV diffs
 * (from day-bucketed historical timestamps) to 0, so 0 means same-day, not instant. */
export function formatDurationDays(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds <= 0) return "<1h";
  if (seconds < 3600) return `${(seconds / 60).toFixed(0)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}GiB`;
  if (abs >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)}MiB`;
  if (abs >= 1024) return `${(n / 1024).toFixed(0)}KiB`;
  return `${n.toFixed(0)}B`;
}

export function formatCores(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1) return `${n.toFixed(2)} cores`;
  return `${(n * 1000).toFixed(0)}m`;
}
