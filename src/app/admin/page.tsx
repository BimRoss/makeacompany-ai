"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiBase } from "@/lib/site";

type WaitlistUser = {
  email: string;
  stripeSessionId: string;
  stripeCustomer: string;
  paymentStatus: string;
  amountTotal: string;
  currency: string;
  updatedAt: string;
  source: string;
};

type Response = { users: WaitlistUser[] };

export default function AdminPage() {
  const [users, setUsers] = useState<WaitlistUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase()}/v1/admin/waitlist`, {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as Response;
        if (!cancelled) {
          setUsers(Array.isArray(json.users) ? json.users : []);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <header className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <Link
            href="/"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Home
          </Link>
        </header>

        <p className="mb-6 text-sm text-muted-foreground">
          Waitlist signups from Redis (<code className="rounded bg-muted px-1 py-0.5 text-xs">makeacompany:waitlist:*</code>
          ).
        </p>

        {error && (
          <p className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {!error && users === null && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {!error && users !== null && users.length === 0 && (
          <p className="text-sm text-muted-foreground">No rows yet.</p>
        )}

        {!error && users !== null && users.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Email</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Payment</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Amount</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Currency</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Updated</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Source</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Session</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Customer</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={`${u.email}-${u.stripeSessionId}`} className="border-b border-border/80 last:border-0">
                    <td className="max-w-[14rem] truncate px-3 py-2 tabular-nums">{u.email}</td>
                    <td className="whitespace-nowrap px-3 py-2">{u.paymentStatus}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{u.amountTotal}</td>
                    <td className="whitespace-nowrap px-3 py-2 uppercase">{u.currency}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{u.updatedAt}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{u.source}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2 font-mono text-xs text-muted-foreground">
                      {u.stripeSessionId}
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-2 font-mono text-xs text-muted-foreground">
                      {u.stripeCustomer}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
