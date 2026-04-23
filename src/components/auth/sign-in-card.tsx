import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type SignInCardProps = {
  title: ReactNode;
  description: ReactNode;
  /** Extra classes on the `<h1>` (e.g. `capitalize` for portal titles). */
  titleClassName?: string;
  headingProps?: ComponentPropsWithoutRef<"h1">;
  messages: ReactNode;
  signIn: ReactNode;
};

export function SignInCard({ title, description, titleClassName, headingProps, messages, signIn }: SignInCardProps) {
  const headingClassName = [
    "text-pretty text-xl font-semibold tracking-tight text-foreground sm:text-2xl",
    titleClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="mx-auto flex w-full flex-1 flex-col items-center justify-center px-4 py-12 sm:py-20">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06] sm:p-10">
        <header className="mb-8 space-y-2 text-center">
          <h1 className={headingClassName} {...headingProps}>
            {title}
          </h1>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{description}</p>
        </header>
        <div className="space-y-6">
          {messages}
          {signIn}
        </div>
      </div>
    </div>
  );
}

export type SignInMethodStackProps = {
  googleOAuthReady: boolean;
  magicEmailReady: boolean;
  googleSlot: ReactNode;
  emailSlot: ReactNode;
  unconfiguredMessage: string;
};

export function SignInMethodStack({
  googleOAuthReady,
  magicEmailReady,
  googleSlot,
  emailSlot,
  unconfiguredMessage,
}: SignInMethodStackProps) {
  const showPrimarySignIn = googleOAuthReady || magicEmailReady;
  if (!showPrimarySignIn) {
    return (
      <p className="rounded-lg border border-border bg-muted/25 px-4 py-3 text-center text-sm text-muted-foreground">
        {unconfiguredMessage}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {googleOAuthReady ? googleSlot : null}
      {googleOAuthReady && magicEmailReady ? <SignInOrDivider /> : null}
      {magicEmailReady ? emailSlot : null}
    </div>
  );
}

function SignInOrDivider() {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px min-w-0 flex-1 bg-border" aria-hidden />
      <span className="shrink-0 text-xs font-medium text-muted-foreground">or</span>
      <div className="h-px min-w-0 flex-1 bg-border" aria-hidden />
    </div>
  );
}
