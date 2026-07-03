import Image from "next/image";
import { ArrowRight } from "lucide-react";

import { PreviewChatMockup } from "@/components/landing/preview-chat-mockup";

const CONTACT_EMAIL = "john@makeacompany.ai";
const CONTACT_BCC = "grant@makeacompany.ai";
const CONTACT_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Multiply with MaC",
)}&bcc=${CONTACT_BCC}`;

/**
 * boardy-style two-column hero: avatar + left-aligned headline + one pill CTA
 * on the left, a Slack chat mockup (our product) on the right. Mirrors
 * boardy.ai's layout while keeping MaC's black/white/blue identity.
 */
export function PreviewHero() {
  return (
    <section className="relative w-full px-6 pb-14 pt-12 sm:pt-16 lg:pb-20 lg:pt-20">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="max-w-xl">
          <span className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-black">
            <Image
              src="/logo-navbar-white.png"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 object-contain"
            />
          </span>

          <h1 className="text-balance text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Multiply yourself. Your best work, in a fraction of the time and
            cost.
          </h1>

          <p className="mt-5 max-w-md text-pretty text-base text-muted-foreground sm:text-lg">
            The builders&apos; incubator. A team of agents that runs your
            company from inside Slack.
          </p>

          <div className="mt-8 flex">
            <a
              href={CONTACT_HREF}
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 text-base font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 sm:h-14 sm:px-9 sm:text-lg"
            >
              Multiply with MaC
              <ArrowRight
                className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 sm:h-5 sm:w-5"
                aria-hidden
              />
            </a>
          </div>

          <p className="mt-4 text-xs text-muted-foreground sm:text-sm">
            By introduction. Our team reviews every request.
          </p>
        </div>

        <div className="lg:pl-4">
          <PreviewChatMockup />
        </div>
      </div>
    </section>
  );
}
