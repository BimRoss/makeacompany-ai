"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

type Props = {
  question: string;
  answer: string;
};

export function FaqAccordionItem({ question, answer }: Props) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const panelId = `faq-panel-${uid}`;
  const triggerId = `faq-trigger-${uid}`;

  return (
    <div
      data-state={open ? "open" : "closed"}
      className="faq-details group rounded-xl border border-border bg-card/60 p-5 data-[state=open]:border-foreground/25 data-[state=open]:bg-card data-[state=open]:shadow-[0_8px_30px_-8px_rgba(0,0,0,0.1)] dark:data-[state=open]:shadow-[0_8px_30px_-8px_rgba(255,255,255,0.06)] md:hover:border-foreground/25 md:hover:bg-card md:hover:shadow-[0_14px_44px_-12px_rgba(0,0,0,0.14)] dark:md:hover:shadow-[0_14px_44px_-12px_rgba(255,255,255,0.08)]"
    >
      <button
        type="button"
        id={triggerId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer list-none items-center justify-between gap-4 text-left text-lg font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span className="text-pretty pr-2 transition-[color] duration-[var(--faq-motion-duration,0.55s)] ease-[var(--faq-motion-ease,cubic-bezier(0.33,1,0.68,1))] md:group-hover:text-foreground">
          {question}
        </span>
        <ChevronDown
          aria-hidden
          className="h-5 w-5 shrink-0 text-muted-foreground transition-[transform,color] duration-[var(--faq-motion-duration,0.55s)] ease-[var(--faq-motion-ease,cubic-bezier(0.33,1,0.68,1))] group-data-[state=open]:rotate-180 md:group-hover:text-foreground"
        />
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        aria-hidden={!open}
        className="faq-details-panel"
      >
        <div className="faq-details-panel-inner" inert={!open}>
          <p className="pt-3 text-pretty text-muted-foreground">{answer}</p>
        </div>
      </div>
    </div>
  );
}
