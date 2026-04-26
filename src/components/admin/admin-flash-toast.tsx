"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const TOAST_MS = 5500;

type FlashPayload = { variant: "success" | "error"; message: string };

type FlashFn = (variant: "success" | "error", message: string) => void;

const AdminFlashToastContext = createContext<FlashFn>(() => {});

export function AdminFlashToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<FlashPayload | null>(null);

  const flash = useCallback<FlashFn>((variant, message) => {
    const text = message.trim();
    if (!text) return;
    setToast({ variant, message: text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <AdminFlashToastContext.Provider value={flash}>
      {children}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-[70] flex justify-center px-4">
          <p
            role="status"
            className={
              toast.variant === "success"
                ? "pointer-events-auto rounded-full border border-foreground bg-background px-5 py-2 text-sm font-medium text-foreground shadow-lg"
                : "pointer-events-auto max-w-[min(100%,36rem)] rounded-full border border-destructive/50 bg-destructive/10 px-5 py-2 text-center text-sm font-medium text-destructive shadow-lg"
            }
          >
            {toast.message}
          </p>
        </div>
      ) : null}
    </AdminFlashToastContext.Provider>
  );
}

export function useAdminFlashToast(): FlashFn {
  return useContext(AdminFlashToastContext);
}
