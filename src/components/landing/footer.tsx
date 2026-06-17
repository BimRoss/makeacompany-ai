import Link from "next/link";
import type { ReactNode } from "react";

type FooterProps = {
  /** Extra controls rendered after the standard nav links (e.g. portal billing). */
  extraNav?: ReactNode;
};

export function Footer({ extraNav }: FooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-border bg-muted/30 py-6 sm:py-8 md:py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6">
        <div className="flex w-full flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex flex-col items-center gap-1 sm:items-start">
            <p className="text-xs text-muted-foreground">
              &copy; {year} makeacompany.ai. All rights reserved.
            </p>
            <p className="text-xs text-muted-foreground">
              Built solo by a{" "}
              <a
                href="https://grantfoster.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="motion-colors underline-offset-2 hover:text-foreground hover:underline"
              >
                principal product engineer
              </a>
              , using the product itself.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <Link href="/privacy" className="motion-colors hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="motion-colors hover:text-foreground">
              Terms
            </Link>
            <Link href="/admin" className="motion-colors hover:text-foreground">
              Admin
            </Link>
            {extraNav}
          </div>
        </div>
      </div>
    </footer>
  );
}
