import Image from "next/image";

import grantAvatar from "../../../public/avatars/grant.jpg";
import rossAvatar from "../../../public/avatars/ross.png";

type Reaction = { emoji: string; count: number };

type SlackMessage = {
  author: "grant" | "ross";
  name: string;
  isApp?: boolean;
  time: string;
  body: React.ReactNode;
  reactions?: Reaction[];
  replyMeta?: { count: number; lastTime: string };
};

const SLACK_FONT = `Lato, "Helvetica Neue", Arial, sans-serif`;

const THREAD: SlackMessage[] = [
  {
    author: "grant",
    name: "Grant",
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
    isApp: true,
    time: "10:13 AM",
    body: (
      <div className="space-y-2">
        <div className="font-bold text-[#1d1c1d]">
          📊 makeacompany.ai — last 7 days
        </div>
        <div className="text-[#1d1c1d]">
          <span className="font-mono">█████████████████████</span> healthy growth, <span className="font-bold">+622% WoW</span> 📈
        </div>
        <div className="pt-1">
          <div className="text-[#1d1c1d]">Daily sessions</div>
          <pre className="mt-1 overflow-x-auto rounded-md border border-[#e8e8e8] bg-[#f8f8f8] p-3 font-mono text-[12px] leading-relaxed text-[#1d1c1d]">
{`05/20 ██████████████████ 52
05/21 █████████████████ 49
05/22 ██████████████ 42
05/23 ██████ 18
05/24 ████████████████████ 58 ← peak
05/25 █████████████████ 50
05/26 ███████████████████ 55`}
          </pre>
        </div>
        <div className="pt-1 text-[#1d1c1d]">
          LinkedIn is doing real work (66 referrals, ~20% of sessions). Organic search is tiny — SEO is still untapped.
        </div>
      </div>
    ),
    reactions: [
      { emoji: "🙌", count: 1 },
      { emoji: "📈", count: 1 },
    ],
  },
  {
    author: "grant",
    name: "Grant",
    time: "9:36 AM",
    body: <>Crushing SEO Ross good job 🙌</>,
    replyMeta: { count: 1, lastTime: "9:38 AM" },
  },
];

function Avatar({ author }: { author: SlackMessage["author"] }) {
  const src = author === "ross" ? rossAvatar : grantAvatar;
  const alt = author === "ross" ? "Ross" : "Grant";
  return (
    <Image
      src={src}
      alt={alt}
      width={36}
      height={36}
      className="h-9 w-9 shrink-0 rounded-[4px] object-cover"
    />
  );
}

function ReactionPill({ emoji, count }: Reaction) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#1264a3]/30 bg-[#e8f5fa] px-2 py-0.5 text-xs font-semibold text-[#1264a3]">
      <span className="text-sm leading-none">{emoji}</span>
      <span className="tabular-nums">{count}</span>
    </span>
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

        <div
          className="mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-[#e1e1e1] bg-white text-[15px] text-[#1d1c1d] shadow-[0_8px_30px_-12px_rgba(0,0,0,0.18)]"
          style={{ fontFamily: SLACK_FONT }}
        >
          {/* Channel header — mirrors Slack's top bar */}
          <div className="flex items-center justify-between border-b border-[#e1e1e1] bg-white px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-base font-bold leading-none text-[#1d1c1d]">#</span>
              <span className="truncate text-[15px] font-bold leading-none text-[#1d1c1d]">sales</span>
              <span className="hidden text-[13px] text-[#616061] sm:inline">
                · the deals channel
              </span>
            </div>
            <span className="text-[12px] text-[#616061]">makeacompany Slack</span>
          </div>

          <ol>
            {THREAD.map((msg, i) => (
              <li
                key={i}
                className="group relative flex gap-3 px-5 py-2 transition-colors hover:bg-[#f8f8f8] sm:px-6"
              >
                <Avatar author={msg.author} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[15px] font-extrabold text-[#1d1c1d]">
                      {msg.name}
                    </span>
                    {msg.isApp && (
                      <span className="rounded-[3px] bg-[#e8e8e8] px-1 py-px text-[10px] font-bold uppercase leading-tight tracking-wide text-[#616061]">
                        APP
                      </span>
                    )}
                    <span className="text-[12px] text-[#616061]">{msg.time}</span>
                  </div>
                  <div className="mt-0.5 text-[15px] leading-[1.46668] text-[#1d1c1d]">
                    {msg.body}
                  </div>
                  {msg.reactions && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {msg.reactions.map((r) => (
                        <ReactionPill key={r.emoji} {...r} />
                      ))}
                    </div>
                  )}
                  {msg.replyMeta && (
                    <button
                      type="button"
                      className="mt-1.5 inline-flex items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-[13px] font-semibold text-[#1264a3] hover:border-[#e1e1e1] hover:bg-white"
                    >
                      <span>
                        {msg.replyMeta.count} {msg.replyMeta.count === 1 ? "reply" : "replies"}
                      </span>
                      <span className="text-[12px] font-normal text-[#616061]">
                        Last reply {msg.replyMeta.lastTime} · View thread
                      </span>
                    </button>
                  )}
                </div>
                {/* Hover-revealed full timestamp on the right, Slack-style */}
                <span className="pointer-events-none absolute right-5 top-2 hidden text-[11px] tabular-nums text-[#616061] opacity-0 group-hover:opacity-100 sm:block">
                  {msg.time}
                </span>
              </li>
            ))}
          </ol>

          <div className="border-t border-[#e1e1e1] bg-[#fafafa] px-5 py-3 text-center text-[12px] text-[#616061] sm:px-6">
            Real thread, lightly edited for length. Ross is the same agent you get when you sign up.
          </div>
        </div>
      </div>
    </section>
  );
}
