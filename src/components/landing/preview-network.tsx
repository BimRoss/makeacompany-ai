"use client";

import { useState } from "react";

// The network strip (boardy's "I've made intros to people at" analogue). John's
// company voice: people MaC has worked with come from these companies and are
// now building or bettering their own. Auto-scrolling marquee of logo + name
// chips, real logos from logo.dev. The logo sits on a FIXED-size white tile so
// the image loading in can never resize its cell — that's what keeps the row
// from reflowing/overlapping while it scrolls. Name always shows; if a logo
// fails to load the chip is just the name.

// Publishable logo.dev key (John's, 2026-07-03). It rides in the image URL in
// the browser by design, so it is safe to keep in the client bundle.
const LOGODEV_TOKEN = "pk_W-hvspybR8OzNFwPDlYRSg";
const COMPANIES: { name: string; domain: string }[] = [
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
  { name: "Equinox", domain: "equinox.com" },
  { name: "ClassDojo", domain: "classdojo.com" },
  { name: "BCBS", domain: "bcbs.com" },
  { name: "Tempo", domain: "tempo.fit" },
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

function Logo({ name, domain }: { name: string; domain: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className="flex items-center gap-2.5 whitespace-nowrap">
      {!failed ? (
        <span className="flex h-10 w-12 shrink-0 items-center justify-center rounded-lg bg-white px-1.5 ring-1 ring-black/5">
          {/* Plain <img> so we can hotlink logo.dev without configuring
              next/image remote patterns. The tile is a FIXED size so the image
              loading in can never reflow the row; onError just drops the mark
              and the name stays. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://img.logo.dev/${domain}?token=${LOGODEV_TOKEN}&size=200&format=png&retina=true`}
            alt=""
            aria-hidden
            loading="lazy"
            onError={() => setFailed(true)}
            className="max-h-6 w-auto max-w-[36px] object-contain"
          />
        </span>
      ) : null}
      <span className="text-sm font-semibold tracking-tight text-foreground/80 sm:text-base">
        {name}
      </span>
    </span>
  );
}

export function PreviewNetwork() {
  // Duplicate the list so the -50% translate loops seamlessly.
  const track = [...COMPANIES, ...COMPANIES];

  return (
    <section className="border-y border-border/60 py-14 sm:py-20">
      <div className="mx-auto w-full max-w-4xl px-6 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          The network
        </p>
        <h2 className="mx-auto max-w-2xl text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          MaC has helped people from these companies build or better their own.
        </h2>
      </div>

      <div className="preview-marquee relative mt-10 w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
        <ul className="preview-marquee-track flex w-max items-center gap-8">
          {track.map((company, i) => (
            <li
              key={`${company.domain}-${i}`}
              className="flex h-12 shrink-0 items-center"
              aria-hidden={i >= COMPANIES.length}
            >
              <Logo name={company.name} domain={company.domain} />
            </li>
          ))}
        </ul>
      </div>

      <p className="mx-auto mt-10 max-w-md text-balance px-6 text-center text-base font-medium text-foreground sm:text-lg">
        Now they&apos;re multiplying with MaC.
      </p>
    </section>
  );
}
