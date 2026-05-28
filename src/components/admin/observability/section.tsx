"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type ObservabilitySectionProps = {
  id: string;
  title: string;
  description?: string;
  defaultOpen?: boolean;
  /** Right-aligned slot in the section header (e.g. dashboard link). */
  endSlot?: ReactNode;
  children: ReactNode;
};

export function ObservabilitySection({
  id,
  title,
  description,
  defaultOpen = true,
  endSlot,
  children,
}: ObservabilitySectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = `${id}-content`;
  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between gap-3 px-0.5">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-controls={contentId}
          className="group inline-flex items-center gap-2 rounded-md py-0.5 text-left text-foreground transition hover:text-foreground/80"
        >
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden="true"
          />
          <div className="space-y-0.5">
            <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
            {description ? (
              <p className="text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </button>
        {endSlot ? <div className="shrink-0">{endSlot}</div> : null}
      </header>
      {open ? <div id={contentId}>{children}</div> : null}
    </section>
  );
}
