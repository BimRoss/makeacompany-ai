"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The network strip (boardy's "I've made intros to people at" analogue). John's
// company voice: people MaC has worked with come from these companies and are
// now building or bettering their own. An auto-sliding + draggable carousel of
// logo + name chips (same engine as the testimonials rail), real logos from
// logo.dev, ordered alphabetically. Touch devices use native horizontal
// scrolling; mouse users can grab and drag the row. The logo sits on a
// FIXED-size white tile so the image loading in can never resize its
// cell — that's what keeps the row from reflowing/overlapping. Name always
// shows; if a logo fails to load the chip is just the name.

// Publishable logo.dev key (John's, 2026-07-03). It rides in the image URL in
// the browser by design, so it is safe to keep in the client bundle.
const LOGODEV_TOKEN = "pk_W-hvspybR8OzNFwPDlYRSg";

// Per-company logo source. Default is logo.dev by `domain`. Overrides:
//  - `logo`: a bundled asset in /public for brands logo.dev gets wrong or has
//    no real mark for (Equinox — logo.dev returns another company's "f/m").
//  - `logoDomain`: pull from logo.dev under a different domain that has the
//    correct mark (BCBS — bcbs.com is a grey placeholder, the Association
//    domain has the real one).
//  - `noLogo`: logo.dev has nothing usable and we have no clean asset yet, so
//    show the name on its own rather than a wrong/blank mark (Tempo).
type Company = {
  name: string;
  domain: string;
  logo?: string;
  logoDomain?: string;
  noLogo?: boolean;
};

const COMPANIES: Company[] = [
  { name: "WeWork", domain: "wework.com" },
  { name: "Meta", domain: "meta.com" },
  { name: "Cloudflare", domain: "cloudflare.com" },
  { name: "Deutsche Bank", domain: "db.com" },
  { name: "Apple", domain: "apple.com" },
  { name: "Google", domain: "google.com" },
  { name: "PGA of America", domain: "pga.com" },
  { name: "Autograph", domain: "autograph.io" },
  { name: "OnCore Golf", domain: "oncoregolf.com" },
  { name: "Arup", domain: "arup.com" },
  { name: "Voyansi", domain: "voyansi.com" },
  { name: "Equinox", domain: "equinox.com", logo: "/preview-logos/equinox.png" },
  { name: "ClassDojo", domain: "classdojo.com" },
  { name: "BCBS", domain: "bcbs.com", logoDomain: "bluecrossblueshield.com" },
  { name: "Tempo", domain: "tempo.fit", logo: "/preview-logos/tempo.png" },
  { name: "Swimply", domain: "swimply.com" },
  { name: "Meritain Health", domain: "meritain.com" },
  { name: "WebMD", domain: "webmd.com" },
  { name: "Hewlett Packard", domain: "hp.com" },
  { name: "HSBC", domain: "hsbc.com" },
  { name: "SHoP Architects", domain: "shoparc.com" },
  { name: "Bloomberg", domain: "bloomberg.com" },
  { name: "M&T Bank", domain: "mtb.com" },
  { name: "Citi", domain: "citi.com" },
  { name: "CFA Institute", domain: "cfainstitute.org" },
  { name: "US Dept of Health & Human Services", domain: "hhs.gov" },
];

function Logo({ company }: { company: Company }) {
  const [failed, setFailed] = useState(false);
  const src =
    company.logo ??
    `https://img.logo.dev/${company.logoDomain ?? company.domain}?token=${LOGODEV_TOKEN}&size=200&format=png&retina=true`;
  const showLogo = !company.noLogo && !failed;

  return (
    <span className="flex items-center gap-2.5 whitespace-nowrap">
      {showLogo ? (
        <span className="flex h-10 w-12 shrink-0 items-center justify-center rounded-lg bg-white px-1.5 ring-1 ring-black/5">
          {/* Plain <img> so we can hotlink logo.dev without configuring
              next/image remote patterns. The tile is a FIXED size so the image
              loading in can never reflow the row; onError just drops the mark
              and the name stays. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            aria-hidden
            loading="lazy"
            onError={() => setFailed(true)}
            className="max-h-6 w-auto max-w-[36px] object-contain"
          />
        </span>
      ) : null}
      <span className="text-sm font-semibold tracking-tight text-foreground/80 sm:text-base">
        {company.name}
      </span>
    </span>
  );
}

// Alphabetical, case- and locale-aware. Sorted once at module load keeps the
// list self-maintaining — new companies land in the right slot automatically.
const SORTED = [...COMPANIES].sort((a, b) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
);

export function PreviewNetwork() {
  // Auto-sliding + draggable rail, same engine as the testimonials carousel.
  // Three copies + recenter-to-middle loop seamlessly in either direction; the
  // visitor can grab (mouse), swipe (touch), or trackpad-scroll it, and the
  // auto-drift pauses while they do.
  const scroller = useRef<HTMLUListElement>(null);
  const hoverRef = useRef(false);
  const draggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartScrollRef = useRef(0);
  const pauseRef = useRef(false);
  const pauseTimerRef = useRef<number | null>(null);
  const initedRef = useRef(false);

  const pauseBriefly = useCallback(() => {
    pauseRef.current = true;
    if (pauseTimerRef.current) window.clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = window.setTimeout(() => {
      pauseRef.current = false;
    }, 1600);
  }, []);

  // Keep scrollLeft parked in the middle copy so both directions have runway.
  const normalizeScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const set = el.scrollWidth / 3;
    if (set <= 0) return;
    if (el.scrollLeft >= set * 2) el.scrollLeft -= set;
    else if (el.scrollLeft < set * 0.5) el.scrollLeft += set;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLUListElement>) => {
    if (e.pointerType !== "mouse") return; // touch/pen use native scrolling
    const el = scroller.current;
    if (!el) return;
    draggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartScrollRef.current = el.scrollLeft;
    el.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLUListElement>) => {
    if (!draggingRef.current) return;
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = dragStartScrollRef.current - (e.clientX - dragStartXRef.current);
  }, []);

  const endDrag = useCallback(() => {
    draggingRef.current = false;
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return; // manual drag/scroll still works, just no auto-advance
    }
    const speed = 1.3; // px per frame — matches the testimonials rail
    let raf = 0;
    const step = () => {
      const set = el.scrollWidth / 3;
      if (set > 0) {
        if (!initedRef.current) {
          el.scrollLeft = set; // start in the middle copy
          initedRef.current = true;
        } else if (!hoverRef.current && !draggingRef.current && !pauseRef.current) {
          el.scrollLeft += speed;
          if (el.scrollLeft >= set * 2) el.scrollLeft -= set;
        }
      }
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto w-full max-w-4xl px-6 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Our network of users
        </p>
        <h2 className="mx-auto max-w-2xl text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          Current and alumni of these companies are building with MaC, today:
        </h2>
      </div>

      <ul
        ref={scroller}
        onPointerEnter={() => {
          hoverRef.current = true;
        }}
        onPointerLeave={() => {
          hoverRef.current = false;
          endDrag();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onScroll={normalizeScroll}
        onWheel={pauseBriefly}
        onTouchStart={pauseBriefly}
        onTouchMove={pauseBriefly}
        className="preview-scroller relative mt-10 flex w-full cursor-grab select-none items-center gap-8 overflow-x-auto px-6 pb-2 active:cursor-grabbing"
        style={{
          maskImage:
            "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
          touchAction: "pan-x",
        }}
        role="region"
        aria-label="Companies in the MaC network"
      >
        {[0, 1, 2].map((copy) =>
          SORTED.map((company) => (
            <li
              key={copy === 0 ? company.domain : `${company.domain}-copy${copy}`}
              className="flex h-12 shrink-0 items-center"
              aria-hidden={copy !== 0}
            >
              <Logo company={company} />
            </li>
          )),
        )}
      </ul>

      <p className="mx-auto mt-10 max-w-md text-balance px-6 text-center text-base font-medium text-foreground sm:text-lg">
        Now they&apos;re building their own, multiplying with MaC.
      </p>
    </section>
  );
}
