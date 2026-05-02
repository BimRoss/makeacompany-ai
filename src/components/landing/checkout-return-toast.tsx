"use client";

import { useEffect, useState } from "react";
import { apiBase } from "@/lib/site";
import { WAITLIST_REFRESH_EVENT } from "@/lib/waitlist";
const TOAST_MS = 6000;

type CheckoutStatusResponse = {
  registered?: boolean;
  paymentStatus?: string;
  email?: string;
  error?: string;
  waitlistFull?: boolean;
};

export function CheckoutReturnToast() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    function clearCheckoutQuery() {
      const params = new URLSearchParams(window.location.search);
      params.delete("checkout");
      params.delete("session_id");
      const q = params.toString();
      const nextURL = `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", nextURL);
    }

    async function processReturn() {
      const params = new URLSearchParams(window.location.search);
      const checkout = params.get("checkout");
      const sessionID = params.get("session_id");

      if (checkout === "cancelled") {
        setMessage("Checkout cancelled. You can subscribe anytime from the homepage.");
        clearCheckoutQuery();
        return;
      }

      if (checkout !== "success" || !sessionID) {
        return;
      }

      const dedupeKey = `checkout-session:${sessionID}`;
      if (window.sessionStorage.getItem(dedupeKey) === "done") {
        clearCheckoutQuery();
        return;
      }

      try {
        const res = await fetch(
          `${apiBase()}/v1/billing/checkout-status?session_id=${encodeURIComponent(sessionID)}`,
          { method: "GET", cache: "no-store" },
        );
        const data = (await res.json()) as CheckoutStatusResponse;
        if (!res.ok) {
          throw new Error(data.error ?? "Unable to confirm registration");
        }

        if (!mounted) {
          return;
        }
        if (data.registered) {
          setMessage("You're subscribed. Welcome aboard!");
          window.dispatchEvent(new CustomEvent(WAITLIST_REFRESH_EVENT));
          window.sessionStorage.setItem(dedupeKey, "done");
          window.localStorage.setItem("makeacompany:registered", "true");
        } else if (data.waitlistFull) {
          setMessage(
            "We couldn't complete your signup. If you were charged, contact us for a refund.",
          );
          window.dispatchEvent(new CustomEvent(WAITLIST_REFRESH_EVENT));
          window.sessionStorage.setItem(dedupeKey, "done");
        } else {
          setMessage("Payment is still processing. Refresh in a moment.");
        }
      } catch (err) {
        if (mounted) {
          setMessage(err instanceof Error ? err.message : "Unable to confirm registration");
        }
      } finally {
        clearCheckoutQuery();
      }
    }

    void processReturn();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!message) {
      return;
    }
    const timer = setTimeout(() => setMessage(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex justify-center px-4">
      <p className="pointer-events-auto rounded-full border border-foreground bg-background px-5 py-2 text-sm font-medium shadow-lg">
        {message}
      </p>
    </div>
  );
}
