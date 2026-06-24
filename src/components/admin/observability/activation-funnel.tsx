"use client";

import { useMemo } from "react";

import { useRangeQuery } from "./charts/use-range-query";
import { formatCompact, formatPercent } from "./charts/format";

// The activation funnel is the all-time "how many actually reach value" read.
// Value == first app shipped (a merged PR on the user's site repo, #621), with
// first message kept as the intermediate step on the way there. We deliberately
// don't slice this by 7/30/90d cohort: at this population a cohort split leaves
// single-digit counts that read as noise. Latency (how *long* it takes those who
// convert) is the cohort-windowed view; this is the count view.
const SIGNED_UP = "sum(makeacompany_lifecycle_users)";
const FIRST_MESSAGE = 'makeacompany_ttfv_sample_size{cohort="all"}';
const FIRST_APP = 'makeacompany_ttfv_pr_sample_size{cohort="all"}';

type Stage = {
  key: string;
  label: string;
  hint: string;
  count: number;
  // Conversion from the previous stage. null on the first stage.
  fromPrev: number | null;
};

function lastValue(series: ReturnType<typeof useRangeQuery>["series"], query: string): number {
  const s = (series ?? []).find((row) => row.query === query);
  const last = s?.points.at(-1);
  return last ? last[1] : 0;
}

export function ActivationFunnel() {
  const { series, loading, errored } = useRangeQuery(
    [SIGNED_UP, FIRST_MESSAGE, FIRST_APP],
    "now-1h",
  );

  const stages = useMemo<Stage[]>(() => {
    const signedUp = lastValue(series, SIGNED_UP);
    const firstMessage = lastValue(series, FIRST_MESSAGE);
    const firstApp = lastValue(series, FIRST_APP);
    const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);
    return [
      { key: "signed_up", label: "Signed up", hint: "all users", count: signedUp, fromPrev: null },
      {
        key: "first_message",
        label: "First message",
        hint: "sent a message",
        count: firstMessage,
        fromPrev: ratio(firstMessage, signedUp),
      },
      {
        key: "first_app",
        label: "First app shipped",
        hint: "merged a PR",
        count: firstApp,
        fromPrev: ratio(firstApp, firstMessage),
      },
    ];
  }, [series]);

  if (errored) {
    return (
      <div className="rounded-xl border border-border bg-card px-3 py-3">
        <p className="text-[11px] text-muted-foreground">Funnel metrics aren&apos;t reporting.</p>
      </div>
    );
  }

  const top = stages[0]?.count ?? 0;

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3">
      {loading && series === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          {stages.map((s, i) => {
            // Bar width is the stage's share of the top stage, so the funnel
            // narrows visually. Floor at a sliver so a non-zero stage is always
            // visible even when it's a tiny fraction of signups.
            const share = top > 0 ? s.count / top : 0;
            const width = s.count > 0 ? Math.max(share * 100, 6) : 0;
            // The deepest reached stage is the one we care about most — paint it
            // in the single blue accent; the rest stay ink/black per brand.
            const isAccent = i === stages.length - 1;
            return (
              <div key={s.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium text-foreground">{s.label}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {s.fromPrev !== null ? `${formatPercent(s.fromPrev)} of prev` : s.hint}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-6 flex-1 overflow-hidden rounded-md bg-muted/60">
                    <div
                      className="h-full rounded-md transition-all duration-500"
                      style={{
                        width: `${width}%`,
                        backgroundColor: isAccent ? "var(--chart-accent)" : "var(--chart-ink)",
                      }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                    {formatCompact(s.count)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
