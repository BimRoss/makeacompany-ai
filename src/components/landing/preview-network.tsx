// John's operator network — companies he's helped people build or better their
// own ventures from. Attributed to John (first-person track record), not framed
// as MaC customers. Rendered as plain wordmarks (no logo assets, no marquee) to
// stay inside the brand contract: black/white, one accent, minimal motion.
const COMPANIES = [
  "WeWork",
  "Meta",
  "Cloudflare",
  "Deutsche Bank",
  "Apple",
  "Google",
  "PGA of America",
  "Autograph",
  "OnCore Golf",
  "Arup",
  "Voyansi",
  "Equinox",
  "ClassDojo",
  "Highmark BCBS",
  "Meritain Health",
];

export function PreviewNetwork() {
  return (
    <section className="border-y border-border bg-muted/20 py-14 sm:py-20">
      <div className="mx-auto w-full max-w-4xl px-6 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          The network
        </p>
        <h2 className="mx-auto max-w-2xl text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          I&apos;ve helped people from these companies build or better their
          own.
        </h2>
        <p className="mx-auto mt-3 text-sm text-muted-foreground">
          John Osberg, Co-Founder
        </p>

        <ul className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-x-8 gap-y-4">
          {COMPANIES.map((company) => (
            <li
              key={company}
              className="text-base font-semibold tracking-tight text-foreground/70 sm:text-lg"
            >
              {company}
            </li>
          ))}
        </ul>

        <p className="mx-auto mt-10 max-w-md text-balance text-base font-medium text-foreground sm:text-lg">
          Now they&apos;re multiplying with MaC.
        </p>
      </div>
    </section>
  );
}
