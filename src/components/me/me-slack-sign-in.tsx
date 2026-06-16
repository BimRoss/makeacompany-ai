export function MeSlackSignIn() {
  return (
    <a
      href="/api/me/auth/slack/start"
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 text-base font-semibold text-foreground shadow-sm transition hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30 dark:bg-zinc-950 dark:hover:bg-zinc-900"
    >
      <SlackMark className="h-5 w-5 shrink-0" aria-hidden />
      Continue with Slack
    </a>
  );
}

function SlackMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" />
      <path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" />
      <path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.272 0a2.528 2.528 0 0 1-2.522 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.162 0a2.528 2.528 0 0 1 2.522 2.522v6.312z" />
      <path fill="#ECB22E" d="M15.162 18.956a2.528 2.528 0 0 1 2.522 2.522A2.528 2.528 0 0 1 15.162 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.272a2.527 2.527 0 0 1-2.52-2.522 2.526 2.526 0 0 1 2.52-2.52h6.317A2.527 2.527 0 0 1 24 15.162a2.528 2.528 0 0 1-2.522 2.522h-6.316z" />
    </svg>
  );
}
