import Link from "next/link";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-muted/30 py-8 sm:py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6">
        <div className="flex w-full flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            &copy; {year} makeacompany.ai. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <Link href="/privacy" className="motion-colors hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="motion-colors hover:text-foreground">
              Terms
            </Link>
            <a href="mailto:hello@makeacompany.ai" className="motion-colors hover:text-foreground">
              Contact
            </a>
            <Link href="/admin" className="motion-colors hover:text-foreground">
              Admin
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
