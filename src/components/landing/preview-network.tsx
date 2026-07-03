"use client";

import { useState } from "react";

// The network strip (boardy's "I've made intros to people at" analogue). John's
// company voice: people MaC has worked with come from these companies and are
// now building or bettering their own. Auto-scrolling marquee for movement.
// Each entry is a chip: the company's real logo (logo.dev, by domain) on a
// white tile so it stays legible in both themes, next to the company name so
// niche icon-marks are still identifiable. If a logo fails to load the name
// stays. List + domains are John's.

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
    <span className="flex items-center gap-3 whitespace-nowrap">
      {!failed ? (
        <span className="flex h-11 shrink-0 items-center justify-center rounded-lg bg-white px-2.5 ring-1 ring-black/5">
          {/* Plain <img> so we can hotlink logo.dev without configuring
              next/image remote patterns; onError drops the mark, name stays. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://img.logo.dev/${domain}?token=${LOGODEV_TOKEN}&size=200&format=png&retina=true`}
            alt={name}
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-7 w-auto max-w-[120px] object-contain"
          />
        </span>
      ) : null}
      <span className="text-base font-semibold tracking-tight text-foreground/80 sm:text-lg">
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
        <ul className="preview-marquee-track flex w-max items-center gap-12">
          {track.map((company, i) => (
            <li
              key={`${company.domain}-${i}`}
              className="flex shrink-0 items-center"
              aria-hidden={i >= COMPANIES.length}
            >
              <Logo name={company.name} domain={company.domain} />
            </li>
          ))}
        </ul>
      </div>

      <p className="mx-auto mt-10 max-w-md text-balance px-6 text-base font-medium text-foreground sm:text-lg">
        Now they&apos;re multiplying with MaC.
      </p>
    </section>
  );
}
