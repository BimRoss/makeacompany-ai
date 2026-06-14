import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { meSessionCookieName } from "@/lib/me-session-cookies";

type Billing = {
  hasManageableSubscription?: boolean;
  subscriptionStatus?: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: number;
};

type MePayload = {
  authenticated?: boolean;
  email?: string;
  slackUserId?: string;
  tier?: string;
  freeLifetime?: boolean;
  expiresAt?: string;
  billing?: Billing;
};

export const dynamic = "force-dynamic";

async function fetchMe(token: string): Promise<MePayload | null> {
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/me/auth/me`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json().catch(() => null)) as MePayload | null;
  } catch {
    return null;
  }
}

export default async function MePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(meSessionCookieName)?.value ?? "";
  if (!token) {
    redirect("/me/login?auth=required");
  }
  const me = await fetchMe(token);
  if (!me?.authenticated || !me.email) {
    redirect("/me/login?auth=required");
  }

  return (
    <div className="mx-auto flex w-full flex-col gap-4 py-8 sm:py-10">
      <h1 className="text-pretty text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        Your account
      </h1>

      <AccountCard me={me} />
      <PersonalAgentsCard />
    </div>
  );
}

const PILL_TONES = {
  neutral:
    "border-border bg-muted/40 text-muted-foreground",
  positive:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger:
    "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
} as const;

type PillTone = keyof typeof PILL_TONES;

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: PillTone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

function statusTone(status: string): PillTone {
  switch (status) {
    case "active":
    case "trialing":
      return "positive";
    case "past_due":
    case "unpaid":
      return "warning";
    case "canceled":
    case "incomplete":
    case "incomplete_expired":
      return "danger";
    default:
      return "neutral";
  }
}

function formatRenewDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function AccountCard({ me }: { me: MePayload }) {
  const billing = me.billing ?? {};
  const status = (billing.subscriptionStatus ?? "").trim();
  const cancelAtEnd = Boolean(billing.cancelAtPeriodEnd);
  const periodEndUnix =
    typeof billing.currentPeriodEnd === "number" && billing.currentPeriodEnd > 0
      ? billing.currentPeriodEnd
      : null;
  const tier = me.tier?.trim();

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold tracking-tight text-foreground">Account</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {status ? <Pill tone={statusTone(status)}>{status}</Pill> : null}
          {tier ? <Pill>{tier}</Pill> : null}
          {me.freeLifetime ? <Pill tone="positive">free lifetime</Pill> : null}
          {cancelAtEnd ? <Pill tone="warning">cancels at period end</Pill> : null}
        </div>
      </div>
      <dl className="mt-4 divide-y divide-border/60 text-sm">
        <Row label="Email" value={me.email ?? "—"} mono />
        <Row label="Slack user ID" value={me.slackUserId?.trim() || "—"} mono />
        {periodEndUnix ? (
          <Row label={cancelAtEnd ? "Ends" : "Renews"} value={formatRenewDate(periodEndUnix)} />
        ) : null}
      </dl>
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`min-w-0 truncate text-right text-foreground ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function PersonalAgentsCard() {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight text-foreground">Personal agents</h2>
        <Pill>Coming soon</Pill>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Your own agents, attached to this account. We&apos;ll surface them here as we open the gate.
      </p>
    </section>
  );
}
