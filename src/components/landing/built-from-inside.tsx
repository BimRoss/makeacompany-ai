import { Hash } from "lucide-react";

type SlackMessage = {
  author: "grant" | "ross";
  name: string;
  role: string;
  time: string;
  body: React.ReactNode;
};

const THREAD: SlackMessage[] = [
  {
    author: "grant",
    name: "Grant",
    role: "founder",
    time: "10:13 AM",
    body: (
      <>
        ross how does our google analytics look? we also improved SEO today so excited about that
      </>
    ),
  },
  {
    author: "ross",
    name: "Ross",
    role: "AI · Head of Automation",
    time: "10:13 AM",
    body: (
      <div className="space-y-2">
        <div className="font-medium text-foreground">
          📊 makeacompany.ai — last 7 days
        </div>
        <div className="text-muted-foreground">
          <span className="font-mono">█████████████████████</span> healthy growth, <span className="font-semibold text-foreground">+622% WoW</span> 📈
        </div>
        <div className="pt-1">
          <div className="text-foreground">Daily sessions</div>
          <pre className="mt-1 overflow-x-auto rounded-md bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
{`05/20 ██████████████████ 52
05/21 █████████████████ 49
05/22 ██████████████ 42
05/23 ██████ 18
05/24 ████████████████████ 58 ← peak
05/25 █████████████████ 50
05/26 ███████████████████ 55`}
          </pre>
        </div>
        <div className="pt-1 text-muted-foreground">
          LinkedIn is doing real work (66 referrals, ~20% of sessions). Organic search is tiny — SEO is still untapped.
        </div>
      </div>
    ),
  },
  {
    author: "grant",
    name: "Grant",
    role: "founder",
    time: "9:36 AM (next day)",
    body: <>Crushing SEO Ross good job 🙌</>,
  },
];

function Avatar({ author }: { author: SlackMessage["author"] }) {
  if (author === "ross") {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-foreground text-xs font-bold text-background">
        R
      </div>
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#E8B4B8] text-xs font-bold text-[#1A1A1A]">
      G
    </div>
  );
}

export function BuiltFromInside() {
  return (
    <section className="py-20">
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="mb-10 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Built from inside
          </p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            This site was built from inside the product you&apos;re looking at.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-muted-foreground">
            The Slack bot, the onboarding, this landing page — every change ships from a thread like this one.
          </p>
        </div>

        <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-3">
            <Hash className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-semibold tracking-tight text-foreground">sales</span>
            <span className="text-xs text-muted-foreground">· makeacompany Slack</span>
          </div>

          <ol className="divide-y divide-border/60">
            {THREAD.map((msg, i) => (
              <li key={i} className="flex gap-3 px-5 py-4 sm:px-6">
                <Avatar author={msg.author} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold text-foreground">{msg.name}</span>
                    {msg.author === "ross" && (
                      <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        APP
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{msg.role}</span>
                    <span className="text-xs text-muted-foreground">· {msg.time}</span>
                  </div>
                  <div className="mt-1 text-sm leading-relaxed text-foreground/90">
                    {msg.body}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="border-t border-border/60 bg-muted/20 px-5 py-3 text-center text-xs text-muted-foreground sm:px-6">
            Real thread, lightly edited for length. Ross is the same agent you get when you sign up.
          </div>
        </div>
      </div>
    </section>
  );
}
