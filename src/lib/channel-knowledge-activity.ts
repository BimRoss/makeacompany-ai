import { parseDigestBodyLines, splitDigestMarkdown, type DigestLine } from "@/lib/channel-digest-parse";

const SYNTHETIC_BIN_COUNT = 28;

/** Same shape as digest list markers for filtering body lines. */
const DIGEST_BODY_LINE_RE = /^(  )?- \*\*([^*]+)\*\*: (.*)$/;

export type ActivityGranularity = "minute" | "hour" | "day" | "week" | "synthetic";

export type KnowledgeActivityTimeBin = {
  t0: number;
  t1: number;
  count: number;
};

export type KnowledgeActivityHistogram = {
  bins: KnowledgeActivityTimeBin[];
  tStart: number;
  tEnd: number;
  hasRealTs: boolean;
  granularity: ActivityGranularity;
};

function chooseBinDurationSec(spanSec: number): { durationSec: number; granularity: ActivityGranularity } {
  if (!Number.isFinite(spanSec) || spanSec <= 0) {
    return { durationSec: 60, granularity: "minute" };
  }
  const minute = 60;
  const hour = 3600;
  const day = 86400;
  const week = 7 * day;
  const nMin = Math.ceil(spanSec / minute);
  if (nMin <= 48) {
    return { durationSec: minute, granularity: "minute" };
  }
  const nHr = Math.ceil(spanSec / hour);
  if (nHr <= 72) {
    return { durationSec: hour, granularity: "hour" };
  }
  const nDay = Math.ceil(spanSec / day);
  if (nDay <= 90) {
    return { durationSec: day, granularity: "day" };
  }
  return { durationSec: week, granularity: "week" };
}

/** Per-line time used for binning (matches histogram). */
export function assignDigestLineTimes(lines: DigestLine[]): {
  tPerLine: number[];
  hasRealTs: boolean;
  tStart: number;
  tEnd: number;
} {
  const ts = lines.map((l) => (l.msgTs ? parseFloat(l.msgTs) : NaN));
  const validTs = ts.filter((x) => !Number.isNaN(x));
  let tPerLine: number[];
  let tStart: number;
  let tEnd: number;
  const hasRealTs = validTs.length >= 2;

  if (hasRealTs) {
    const tMin = Math.min(...validTs);
    const tMax = Math.max(...validTs);
    const oMin = Math.min(...lines.map((l) => l.order));
    const oMax = Math.max(...lines.map((l) => l.order));
    tPerLine = lines.map((l, i) => {
      if (!Number.isNaN(ts[i]!)) {
        return ts[i]!;
      }
      if (oMax === oMin) {
        return tMin;
      }
      return tMin + (tMax - tMin) * ((l.order - oMin) / (oMax - oMin));
    });
    tStart = Math.min(...tPerLine);
    tEnd = Math.max(...tPerLine);
  } else {
    const oMin = Math.min(...lines.map((l) => l.order));
    const oMax = Math.max(...lines.map((l) => l.order));
    tPerLine = lines.map((l) => (oMax === oMin ? 0 : (l.order - oMin) / (oMax - oMin)));
    tStart = 0;
    tEnd = 1;
  }

  return { tPerLine, hasRealTs, tStart, tEnd };
}

export function buildKnowledgeActivityHistogram(markdown: string): KnowledgeActivityHistogram | null {
  const { bodyLines } = splitDigestMarkdown(markdown);
  const lines = parseDigestBodyLines(bodyLines);
  if (lines.length === 0) {
    return null;
  }

  const { tPerLine, hasRealTs, tStart, tEnd } = assignDigestLineTimes(lines);

  if (!hasRealTs) {
    const bins: KnowledgeActivityTimeBin[] = [];
    const span = tEnd - tStart || 1;
    for (let i = 0; i < SYNTHETIC_BIN_COUNT; i++) {
      const u0 = i / SYNTHETIC_BIN_COUNT;
      const u1 = (i + 1) / SYNTHETIC_BIN_COUNT;
      bins.push({ t0: tStart + span * u0, t1: tStart + span * u1, count: 0 });
    }
    for (const t of tPerLine) {
      const u = Math.min(1, Math.max(0, (t - tStart) / span));
      const idx = Math.min(SYNTHETIC_BIN_COUNT - 1, Math.floor(u * SYNTHETIC_BIN_COUNT));
      bins[idx]!.count += 1;
    }
    return { bins, tStart, tEnd, hasRealTs: false, granularity: "synthetic" };
  }

  const span = Math.max(tEnd - tStart, 1);
  const { durationSec, granularity } = chooseBinDurationSec(span);
  const t0 = Math.floor(tStart / durationSec) * durationSec;
  const bins: KnowledgeActivityTimeBin[] = [];
  for (let t = t0; t < tEnd + durationSec * 0.001; t += durationSec) {
    bins.push({ t0: t, t1: t + durationSec, count: 0 });
  }
  if (bins.length === 0) {
    bins.push({ t0: tStart, t1: tEnd, count: 0 });
  }
  for (const t of tPerLine) {
    const idx = Math.min(bins.length - 1, Math.max(0, Math.floor((t - t0) / durationSec)));
    bins[idx]!.count += 1;
  }

  return { bins, tStart: bins[0]!.t0, tEnd: Math.max(tEnd, bins[bins.length - 1]!.t1), hasRealTs: true, granularity };
}

function lineInTimeBin(t: number, bin: KnowledgeActivityTimeBin, upperInclusive: boolean): boolean {
  if (upperInclusive) {
    return t >= bin.t0 && t <= bin.t1;
  }
  return t >= bin.t0 && t < bin.t1;
}

/** When `bin` is null, returns `markdown` unchanged. */
export function filterDigestMarkdownByActivityBin(markdown: string, bin: KnowledgeActivityTimeBin | null): string {
  if (!bin) {
    return markdown;
  }
  const { header, bodyLines } = splitDigestMarkdown(markdown);
  const lines = parseDigestBodyLines(bodyLines);
  if (lines.length === 0) {
    return markdown;
  }
  const hist = buildKnowledgeActivityHistogram(markdown);
  const bins = hist?.bins;
  const lastBin = bins && bins.length > 0 ? bins[bins.length - 1]! : null;
  const upperInclusive =
    lastBin != null &&
    Math.abs(lastBin.t0 - bin.t0) < 1e-6 &&
    Math.abs(lastBin.t1 - bin.t1) < 1e-6;

  const { tPerLine } = assignDigestLineTimes(lines);

  let di = 0;
  const kept: string[] = [];
  for (const raw of bodyLines) {
    const line = raw.trimEnd();
    if (line === "") {
      continue;
    }
    if (!DIGEST_BODY_LINE_RE.test(line)) {
      continue;
    }
    const t = tPerLine[di]!;
    di += 1;
    if (lineInTimeBin(t, bin, upperInclusive)) {
      kept.push(raw);
    }
  }

  const body = kept.join("\n");
  if (!header) {
    return body;
  }
  if (!body.trim()) {
    return header;
  }
  return `${header}\n\n${body}`;
}

/** Slack user id (any casing) → display name; same shape as transcript author lookup for digest search. */
export type DigestSearchAuthorLookup = Readonly<Record<string, { readonly displayName: string }>>;

/** Case-insensitive match on digest rows: message text, Slack user id in the line, and optional resolved author display names. Empty / whitespace `query` leaves `markdown` unchanged. */
export function filterDigestMarkdownBySearchQuery(
  markdown: string,
  query: string,
  authorLookup?: DigestSearchAuthorLookup | null,
): string {
  const q = query.trim().toLowerCase();
  if (!q) {
    return markdown;
  }
  const lookup = authorLookup ?? null;
  const hasAuthorNames = lookup != null && Object.keys(lookup).length > 0;
  const { header, bodyLines } = splitDigestMarkdown(markdown);
  const kept: string[] = [];
  for (const raw of bodyLines) {
    const line = raw.trimEnd();
    if (line === "") {
      continue;
    }
    const m = line.match(DIGEST_BODY_LINE_RE);
    if (!m) {
      continue;
    }
    const lower = line.toLowerCase();
    if (lower.includes(q)) {
      kept.push(raw);
      continue;
    }
    if (hasAuthorNames) {
      const userKey = m[2]!.trim().toUpperCase();
      const display = String(lookup[userKey]?.displayName ?? "")
        .trim()
        .toLowerCase();
      if (display.includes(q)) {
        kept.push(raw);
      }
    }
  }

  const body = kept.join("\n");
  if (!header) {
    return body;
  }
  if (!body.trim()) {
    return header;
  }
  return `${header}\n\n${body}`;
}
