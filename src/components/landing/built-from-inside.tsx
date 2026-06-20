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

function SlackPrCard({
  repo,
  number,
  title,
  description,
  author,
  additions,
  deletions,
  files,
}: {
  repo: string;
  number: number;
  title: string;
  description: string;
  author: string;
  additions: number;
  deletions: number;
  files: number;
}) {
  return (
    <div className="mt-1 max-w-[560px] rounded-[4px] border border-[#e1e1e1] bg-white">
      <div className="border-l-[4px] border-l-[#36c5f0] px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[12px] text-[#616061]">
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="currentColor"
            aria-hidden
            className="text-[#1d1c1d]"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <span className="truncate font-semibold text-[#1d1c1d]">{repo}</span>
          <span aria-hidden>·</span>
          <span className="text-[#1264a3]">Pull request #{number}</span>
        </div>
        <div className="mt-1.5 flex items-start gap-1.5">
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="currentColor"
            aria-hidden
            className="mt-[3px] shrink-0 text-[#1a7f37]"
          >
            <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
          </svg>
          <span className="text-[15px] font-bold leading-snug text-[#1264a3]">
            {title}
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-snug text-[#616061] line-clamp-2">
          {description}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#616061]">
          <span className="inline-flex items-center gap-1">
            <Image
              src={rossAvatar}
              alt=""
              width={16}
              height={16}
              className="h-4 w-4 rounded-full object-cover"
            />
            <span className="font-mono">{author}</span>
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="tabular-nums">{files}</span> files
          </span>
          <span aria-hidden>·</span>
          <span className="font-semibold text-[#1a7f37] tabular-nums">+{additions}</span>
          <span className="font-semibold text-[#cf222e] tabular-nums">−{deletions}</span>
        </div>
      </div>
    </div>
  );
}

const THREAD: SlackMessage[] = [
  {
    author: "grant",
    name: "Grant",
    time: "9:47 AM",
    body: (
      <>
        ross can we ship the funnel tracking work today? sales briefing tomorrow needs the install→OAuth→first-message→persona chart.
      </>
    ),
  },
  {
    author: "ross",
    name: "Ross",
    isApp: true,
    time: "9:48 AM",
    body: <>On it. Opening the PR now.</>,
  },
  {
    author: "ross",
    name: "Ross",
    isApp: true,
    time: "9:49 AM",
    body: (
      <SlackPrCard
        repo="BimRoss/makeacompany-ai"
        number={512}
        title="feat(admin): track happy-path conversion funnel daily"
        description="Adds a 4-stage daily funnel (install click → OAuth callback → first message → persona view) plus a dashboard tile on /admin. Closes #498."
        author="ross-makeacompany"
        additions={382}
        deletions={47}
        files={14}
      />
    ),
    reactions: [
      { emoji: "👍", count: 1 },
      { emoji: "🚀", count: 1 },
    ],
  },
  {
    author: "ross",
    name: "Ross",
    isApp: true,
    time: "10:11 AM",
    body: (
      <>
        Merged. Cutting <span className="rounded bg-[#f8f8f8] px-1 font-mono text-[13px]">v0.315.0</span>…
      </>
    ),
  },
  {
    author: "ross",
    name: "Ross",
    isApp: true,
    time: "10:18 AM",
    body: (
      <>
        ✅ <span className="font-semibold">makeacompany-ai v0.315.0 is live</span> — funnel tracking (#512) shipped.
      </>
    ),
    replyMeta: { count: 2, lastTime: "10:22 AM" },
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
            File a ticket, refine, watch Ross open the PR, merge, deploy. Every change ships from a thread like this one.
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
              <span className="truncate text-[15px] font-bold leading-none text-[#1d1c1d]">ross-grant</span>
              <span className="hidden text-[13px] text-[#616061] sm:inline">
                · ship things together
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
                      <span className="rounded-[3px] border border-[#e1e1e1] bg-[#f4f4f4] px-1 py-px text-[10px] font-bold uppercase leading-tight tracking-wide text-[#616061]">
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
            Real thread from 2026-06-19. Real PR (#512), real version (v0.315.0). Ross is the same agent you get when you sign up.
          </div>
        </div>
      </div>
    </section>
  );
}
