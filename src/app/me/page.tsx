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
    <div className="mx-auto flex w-full flex-col gap-6 py-10 sm:py-14">
      <header className="space-y-2">
        <h1 className="text-pretty text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Your account
        </h1>
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="text-foreground">{me.email}</span>
        </p>
      </header>

      <IdentityCard me={me} />
      <PersonalAgentsCard />
    </div>
  );
}

function IdentityCard({ me }: { me: MePayload }) {
  const billing = me.billing ?? {};
  const status = (billing.subscriptionStatus ?? "").trim();
  const cancelAtEnd = Boolean(billing.cancelAtPeriodEnd);
  const periodEnd =
    typeof billing.currentPeriodEnd === "number" && billing.currentPeriodEnd > 0
      ? new Date(billing.currentPeriodEnd * 1000)
      : null;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06] sm:p-8">
      <h2 className="text-base font-semibold tracking-tight text-foreground">Identity</h2>
      <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <Row label="Email" value={me.email ?? "—"} mono />
        <Row label="Slack user ID" value={me.slackUserId?.trim() || "—"} mono />
        <Row label="Tier" value={me.tier?.trim() || "—"} />
        <Row label="Free lifetime" value={me.freeLifetime ? "yes" : "no"} />
      </dl>

      <h2 className="mt-8 text-base font-semibold tracking-tight text-foreground">Subscription</h2>
      <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <Row label="Status" value={status || "—"} />
        <Row label="Cancel at period end" value={cancelAtEnd ? "yes" : "no"} />
        <Row
          label="Current period end"
          value={periodEnd ? periodEnd.toUTCString() : "—"}
        />
      </dl>
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono text-foreground" : "text-foreground"}>{value}</dd>
    </div>
  );
}

function PersonalAgentsCard() {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06] sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight text-foreground">Personal agents</h2>
        <span className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
          Coming soon
        </span>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Your own agents, attached to this account. We&apos;ll surface them here as we open the gate.
      </p>
    </section>
  );
}
