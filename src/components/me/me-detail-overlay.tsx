"use client";

import { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";

// Centered modal overlay for the /me grid (#651). Compact agent/add tiles open
// their full detail (the status panel or creation form) in here so the grid
// stays intact. Modal — not drawer — because the detail content is a tall,
// form-heavy "card" that reads as a rounded-2xl card; centered keeps the
// existing card language, where a docked drawer would fight it.
//
// Accessibility: role=dialog + aria-modal, focus trap, focus restore on close,
// Esc to close, backdrop click to close, body scroll lock while open.
export function MeDetailOverlay({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible label for the dialog (visually hidden). */
  title: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The element focused before the overlay opened, so we can restore it on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Move focus into the dialog on open; restore it to the trigger on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    // Defer so the panel is in the DOM before we focus it.
    const t = setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Minimal focus trap: keep Tab cycling within the dialog.
  const onKeyDownTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const root = panelRef.current;
    if (!root) return;
    const focusable = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || active === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-4 backdrop-blur-sm sm:p-6"
      // Backdrop click closes; clicks inside the panel are stopped via target check.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onKeyDownTrap}
        className="relative my-4 w-full max-w-2xl outline-none sm:my-8"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-muted-foreground shadow-sm ring-1 ring-black/[0.06] backdrop-blur transition hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30 dark:bg-zinc-900/80 dark:ring-white/[0.08]"
        >
          <X size={18} aria-hidden />
        </button>
        {children}
      </div>
    </div>
  );
}
