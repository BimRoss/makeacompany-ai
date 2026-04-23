/** Slack-style timestamps in digest markers (numeric compare when both parse as floats). */
export function compareSlackTs(a: string, b: string): number {
  const x = +a;
  const y = +b;
  const xOk = a !== "" && b !== "" && x === x && y === y;
  if (xOk && x !== y) {
    return x < y ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export function stripDigestThreadMarkers(markdown: string): string {
  return markdown.replace(/\s*<!--dac m=[\d.]+(?: t=[\d.]+)?-->/g, "");
}

export type DigestLine = {
  userId: string;
  body: string;
  isReply: boolean;
  order: number;
  msgTs?: string;
  threadTs?: string;
};

export type ThreadUnit = {
  threadKey: string;
  messages: DigestLine[];
  /** True when at least one line carried <!--dac …--> markers (reliable thread grouping). */
  hasMeta: boolean;
};

const DIGEST_LINE_RE = /^(  )?- \*\*([^*]+)\*\*: (.*)$/;

export function splitDigestMarkdown(markdown: string): { header: string; bodyLines: string[] } {
  const lines = markdown.split("\n");
  let startBody = 0;
  if (lines.length > 0 && lines[0].trim().startsWith("#")) {
    startBody = 1;
    while (startBody < lines.length && lines[startBody].trim() === "") {
      startBody++;
    }
  }
  const header = lines.slice(0, startBody).join("\n");
  const bodyLines = lines.slice(startBody);
  return { header, bodyLines };
}

export function parseDigestBodyLines(bodyLines: string[]): DigestLine[] {
  const out: DigestLine[] = [];
  let order = 0;
  for (const raw of bodyLines) {
    const line = raw.trimEnd();
    if (line === "") {
      continue;
    }
    const m = line.match(DIGEST_LINE_RE);
    if (!m) {
      continue;
    }
    const isReply = Boolean(m[1]);
    const userId = m[2]!.trim();
    let rest = m[3]!;
    let msgTs: string | undefined;
    let threadTs: string | undefined;
    const meta = rest.match(/\s*<!--dac m=([\d.]+)(?: t=([\d.]+))?-->\s*$/);
    if (meta && meta.index !== undefined) {
      msgTs = meta[1];
      threadTs = meta[2] ?? undefined;
      rest = rest.slice(0, meta.index).trimEnd();
    }
    out.push({ userId, body: rest, isReply, order, msgTs, threadTs });
    order += 1;
  }
  return out;
}

function digestHasThreadMeta(lines: DigestLine[]): boolean {
  return lines.some((l) => Boolean(l.msgTs));
}

/** Group lines into thread buckets; prefers <!--dac …--> markers when present. */
export function buildThreadUnits(lines: DigestLine[]): ThreadUnit[] {
  if (lines.length === 0) {
    return [];
  }
  const hasMeta = digestHasThreadMeta(lines);
  const byKey = new Map<string, DigestLine[]>();

  if (hasMeta) {
    for (const line of lines) {
      let key: string;
      if (line.threadTs && line.msgTs && line.threadTs !== line.msgTs) {
        key = line.threadTs;
      } else {
        key = line.msgTs ?? `o${line.order}`;
      }
      const arr = byKey.get(key);
      if (arr) {
        arr.push(line);
      } else {
        byKey.set(key, [line]);
      }
    }
  } else {
    let lastRootKey = "";
    for (const line of lines) {
      if (!line.isReply) {
        lastRootKey = `h${line.order}`;
        byKey.set(lastRootKey, [line]);
      } else {
        const key = lastRootKey || `orphan${line.order}`;
        const arr = byKey.get(key);
        if (arr) {
          arr.push(line);
        } else {
          byKey.set(key, [line]);
        }
      }
    }
  }

  const units: ThreadUnit[] = [];
  for (const [threadKey, messages] of byKey) {
    const sorted = [...messages].sort((a, b) => {
      const ta = a.msgTs ?? "";
      const tb = b.msgTs ?? "";
      if (ta && tb) {
        return compareSlackTs(ta, tb);
      }
      return a.order - b.order;
    });
    units.push({ threadKey, messages: sorted, hasMeta });
  }

  units.sort((u, v) => {
    const ta = unitSortKey(u);
    const tb = unitSortKey(v);
    if (ta && tb) {
      return compareSlackTs(ta, tb);
    }
    const oa = u.messages[0]?.order ?? 0;
    const ob = v.messages[0]?.order ?? 0;
    return oa - ob;
  });

  return units;
}

function unitSortKey(u: ThreadUnit): string | undefined {
  const ts = u.messages.map((m) => m.msgTs).filter(Boolean) as string[];
  if (ts.length === 0) {
    return undefined;
  }
  return ts.reduce((a, b) => (compareSlackTs(a, b) <= 0 ? a : b));
}

export function groupLinesByAuthor(lines: DigestLine[]): Map<string, DigestLine[]> {
  const m = new Map<string, DigestLine[]>();
  for (const line of lines) {
    const uid = line.userId;
    const arr = m.get(uid);
    if (arr) {
      arr.push(line);
    } else {
      m.set(uid, [line]);
    }
  }
  return m;
}

/** Authors sorted by first appearance in the digest. */
export function authorColumnOrder(lines: DigestLine[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const line of lines) {
    if (!seen.has(line.userId)) {
      seen.add(line.userId);
      order.push(line.userId);
    }
  }
  return order;
}
