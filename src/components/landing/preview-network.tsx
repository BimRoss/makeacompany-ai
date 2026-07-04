"use client";

import { useRef, useState } from "react";

// The network strip (boardy's "I've made intros to people at" analogue). John's
// company voice: people MaC has worked with come from these companies and are
// now building or bettering their own. A drag/swipe carousel of logo + name
// chips, real logos from logo.dev, ordered alphabetically. Touch devices use
// native horizontal scrolling; mouse users can grab and drag the row. The logo
// sits on a FIXED-size white tile so the image loading in can never resize its
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

export function PreviewNetwork() {
  const scroller = useRef<HTMLUListElement>(null);
  // Mouse drag-to-scroll state. Touch/pen fall through to native scrolling.
  const drag = useRef({ down: false, startX: 0, startScroll: 0, moved: false });

  // Alphabetical, case- and locale-aware. Sorting at render keeps the list
  // self-maintaining — new companies land in the right slot automatically.
  const companies = [...COMPANIES].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );

  function onPointerDown(e: React.PointerEvent<HTMLUListElement>) {
    if (e.pointerType !== "mouse") return;
    const el = scroller.current;
    if (!el) return;
    drag.current = {
      down: true,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLUListElement>) {
    const el = scroller.current;
    if (!el || !drag.current.down) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 3) drag.current.moved = true;
    el.scrollLeft = drag.current.startScroll - dx;
  }

  function endDrag() {
    drag.current.down = false;
  }

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

      <div className="relative mt-10 w-full [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
        <ul
          ref={scroller}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          className="preview-scroller flex w-full cursor-grab select-none items-center gap-8 overflow-x-auto px-6 pb-2 active:cursor-grabbing"
        >
          {companies.map((company) => (
            <li
              key={company.domain}
              className="flex h-12 shrink-0 items-center"
            >
              <Logo company={company} />
            </li>
          ))}
        </ul>
      </div>

      <p className="mx-auto mt-10 max-w-md text-balance px-6 text-center text-base font-medium text-foreground sm:text-lg">
        Now they&apos;re building their own, multiplying with MaC.
      </p>
    </section>
  );
}
