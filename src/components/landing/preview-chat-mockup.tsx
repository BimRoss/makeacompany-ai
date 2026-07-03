import Image from "next/image";

// boardy's hero has an iPhone iMessage mockup on the right. Our analogue is a
// Slack-style chat with a MaC agent, which is literally the product: agents
// doing work from inside Slack. Incoming (agent) bubbles left, your bubbles
// right in the blue accent, a live typing indicator for movement.
type Message = { from: "you" | "agent"; text: string };

const THREAD: Message[] = [
  { from: "you", text: "Draft the launch post and schedule it for 9am." },
  { from: "agent", text: "Done. Draft's in the thread, scheduled for 9am PT." },
  { from: "you", text: "Pull our top 5 leads from this week too." },
];

function TypingDot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400"
      style={{ animationDelay: delay }}
    />
  );
}

export function PreviewChatMockup() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="overflow-hidden rounded-3xl border border-black/10 bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-black/5 px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-black">
            <Image
              src="/logo-navbar-white.png"
              alt=""
              width={22}
              height={22}
              className="h-5 w-5 object-contain"
            />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-black">Ross</p>
            <p className="text-xs text-neutral-500">Agent · makeacompany</p>
          </div>
          <span className="ml-auto h-2.5 w-2.5 rounded-full bg-[#3B82F6]" />
        </div>

        <div className="flex flex-col gap-3 px-5 py-5">
          {THREAD.map((message, i) => (
            <div
              key={i}
              className={
                message.from === "you" ? "flex justify-end" : "flex justify-start"
              }
            >
              <p
                className={
                  "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-snug " +
                  (message.from === "you"
                    ? "rounded-br-sm bg-[#3B82F6] text-white"
                    : "rounded-bl-sm bg-neutral-100 text-neutral-800")
                }
              >
                {message.text}
              </p>
            </div>
          ))}

          <div className="flex justify-start">
            <span className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-neutral-100 px-3.5 py-3">
              <TypingDot delay="0ms" />
              <TypingDot delay="150ms" />
              <TypingDot delay="300ms" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
