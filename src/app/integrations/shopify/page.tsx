import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, Plug } from "lucide-react";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";

export const metadata: Metadata = {
  title: "Shopify integration · MakeaCompany.ai",
  robots: { index: false, follow: false },
};

type Status = "connected" | "error" | "default";

// Human-readable copy for the small set of error reasons emitted by the
// backend OAuth callback (see backend/internal/app/shopify_oauth.go::shopifyCallbackError).
const ERROR_COPY: Record<string, { title: string; detail: string }> = {
  bad_request: {
    title: "Missing or malformed request",
    detail:
      "Shopify didn't send the expected parameters back to us. This usually means the install link was opened directly without going through Connect Shopify first. Start over from the integrations page.",
  },
  bad_hmac: {
    title: "Couldn't verify the response signature",
    detail:
      "The HMAC on Shopify's redirect didn't match what we expected. This can happen if the install link was tampered with or copied between accounts. Start the Connect Shopify flow over from your makeacompany.ai account.",
  },
  expired_state: {
    title: "Install link expired",
    detail:
      "Connect Shopify links are single-use and expire after 30 minutes. Start the flow again to get a fresh link.",
  },
  shop_mismatch: {
    title: "Shop doesn't match",
    detail:
      "The shop in the install link doesn't match the one you authorized. Make sure you're signed into the right Shopify account when you click Connect.",
  },
  exchange_failed: {
    title: "Shopify rejected the install",
    detail:
      "Shopify accepted your consent but rejected our follow-up token request. Often transient — try the Connect Shopify flow again. If it persists, contact support.",
  },
  write_failed: {
    title: "Couldn't save your connection",
    detail:
      "Your consent went through on Shopify's side, but we hit an error storing the credential. Engineering has been alerted. Retry in a few minutes.",
  },
};

type Props = {
  searchParams: Promise<{ status?: string; shop?: string; reason?: string }>;
};

export default async function ShopifyIntegrationPage({ searchParams }: Props) {
  const params = await searchParams;
  const status: Status = (() => {
    if (params.status === "connected") return "connected";
    if (params.status === "error") return "error";
    return "default";
  })();
  const shop = (params.shop ?? "").trim();
  const reasonKey = (params.reason ?? "").trim();
  const reason = ERROR_COPY[reasonKey] ?? {
    title: "We couldn't complete the connection",
    detail: `Shopify reported an unexpected error${reasonKey ? ` (\`${reasonKey}\`)` : ""}. Try the Connect Shopify flow again from your makeacompany.ai account.`,
  };

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <Header />
      <section className="relative px-6 py-16 sm:py-24">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-0 h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
        </div>
        <div className="relative mx-auto w-full max-w-2xl">
          {status === "connected" ? (
            <ConnectedCard shop={shop} />
          ) : status === "error" ? (
            <ErrorCard title={reason.title} detail={reason.detail} />
          ) : (
            <DefaultCard />
          )}
        </div>
      </section>
      <Footer />
    </main>
  );
}

function ConnectedCard({ shop }: { shop: string }) {
  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 sm:p-10">
      <div className="flex items-start gap-4">
        <CheckCircle2 className="mt-1 size-7 shrink-0 text-emerald-500" aria-hidden />
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Shopify connected</h1>
          {shop ? (
            <p className="mt-2 text-base text-muted-foreground">
              Ross can now operate{" "}
              <span className="font-mono text-foreground">{shop}</span> for you.
            </p>
          ) : (
            <p className="mt-2 text-base text-muted-foreground">
              Ross can now operate your Shopify store.
            </p>
          )}
          <p className="mt-4 text-sm text-muted-foreground">
            Head to your Slack channel and ask Ross anything about your store — &quot;what&apos;s on
            the storefront&quot;, &quot;add a draft product called X&quot;, &quot;set inventory for
            Y to 50&quot;, &quot;show me recent orders&quot;.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
            <Link
              href="/"
              className="rounded-full bg-foreground px-4 py-2 font-medium text-background transition-opacity hover:opacity-90"
            >
              Back to makeacompany.ai
            </Link>
            <span className="text-muted-foreground">
              Disconnect anytime from <Link className="underline underline-offset-2 hover:text-foreground" href="/me">your account page</Link>.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorCard({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8 sm:p-10">
      <div className="flex items-start gap-4">
        <AlertTriangle className="mt-1 size-7 shrink-0 text-amber-500" aria-hidden />
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-3 text-base text-muted-foreground">{detail}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
            <Link
              href="/me"
              className="rounded-full bg-foreground px-4 py-2 font-medium text-background transition-opacity hover:opacity-90"
            >
              Back to your account
            </Link>
            <span className="text-muted-foreground">
              Stuck? Ping us in your Slack channel.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DefaultCard() {
  return (
    <div className="rounded-2xl border border-border bg-card p-8 sm:p-10">
      <div className="flex items-start gap-4">
        <Plug className="mt-1 size-7 shrink-0 text-primary" aria-hidden />
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Connect Shopify</h1>
          <p className="mt-3 text-base text-muted-foreground">
            Hook Ross up to your Shopify store so he can read product state, push edits, look at
            orders, and organize collections from your Slack channel.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            Connect Shopify from your{" "}
            <Link className="underline underline-offset-2 hover:text-foreground" href="/me">
              account page
            </Link>{" "}
            — we&apos;ll walk you through Shopify&apos;s consent screen and store the connection
            securely.
          </p>
        </div>
      </div>
    </div>
  );
}
