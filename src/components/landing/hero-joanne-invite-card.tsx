"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MESSAGE =
  "I will send you an invite to your workspace after you sign up! Cancel anytime.";

const ATTRIBUTION = "Joanne, Executive Operations";

const TICK_MS = 26;

export function HeroJoanneInviteCard() {
  const [quoteText, setQuoteText] = useState("");
  const [attrText, setAttrText] = useState("");
  const timersRef = useRef<{ quote: number | null; attr: number | null }>({
    quote: null,
    attr: null,
  });

  const quoteComplete = quoteText.length >= MESSAGE.length;
  const allComplete = quoteComplete && attrText.length >= ATTRIBUTION.length;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      setQuoteText(MESSAGE);
      setAttrText(ATTRIBUTION);
      return;
    }

    let qi = 0;
    timersRef.current.quote = window.setInterval(() => {
      qi += 1;
      setQuoteText(MESSAGE.slice(0, qi));
      if (qi >= MESSAGE.length) {
        if (timersRef.current.quote !== null) {
          window.clearInterval(timersRef.current.quote);
          timersRef.current.quote = null;
        }
        let ai = 0;
        timersRef.current.attr = window.setInterval(() => {
          ai += 1;
          setAttrText(ATTRIBUTION.slice(0, ai));
          if (ai >= ATTRIBUTION.length && timersRef.current.attr !== null) {
            window.clearInterval(timersRef.current.attr);
            timersRef.current.attr = null;
          }
        }, TICK_MS);
      }
    }, TICK_MS);

    return () => {
      if (timersRef.current.quote !== null) {
        window.clearInterval(timersRef.current.quote);
        timersRef.current.quote = null;
      }
      if (timersRef.current.attr !== null) {
        window.clearInterval(timersRef.current.attr);
        timersRef.current.attr = null;
      }
    };
  }, []);

  return (
    <div className="mx-auto mt-3 w-full max-w-md sm:mt-4" role="region" aria-label="Note from Joanne">
      <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card py-2.5 pl-3 pr-2.5 text-left shadow-md sm:gap-3 sm:py-3 sm:pl-3 sm:pr-2.5">
        <div className="flex w-full min-w-0 items-start gap-2.5 sm:gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/headshots/joanne.png"
            alt="Joanne"
            className="h-9 w-9 shrink-0 rounded-full border border-border object-cover sm:h-10 sm:w-10"
          />
          <div className="min-w-0 flex-1">
            <p className="flex items-start gap-1.5 text-pretty text-xs font-medium leading-snug text-foreground sm:gap-2 sm:text-sm">
              <Sparkles
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground sm:h-4 sm:w-4 ${allComplete ? "" : "animate-pulse"}`}
                aria-hidden
              />
              <span className="min-w-0">
                {quoteText}
                {!quoteComplete ? (
                  <span className="ml-0.5 inline-block w-2 animate-pulse font-normal text-muted-foreground" aria-hidden>
                    |
                  </span>
                ) : null}
              </span>
            </p>
          </div>
        </div>
        <p className="min-h-[1rem] text-right text-[10px] text-muted-foreground sm:min-h-[1.125rem] sm:text-[11px]">
          {attrText}
          {quoteComplete && !allComplete ? (
            <span className="ml-0.5 inline-block w-2 animate-pulse font-normal text-muted-foreground/80" aria-hidden>
              |
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}
