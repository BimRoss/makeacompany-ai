import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";

export default function CompanyChannelPage() {
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <Header />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Your company portal</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You&apos;re signed in. Talk to Joanne or your channel agent directly in Slack.
        </p>
      </div>
      <Footer />
    </main>
  );
}
