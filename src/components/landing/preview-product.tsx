// A short product explainer so a first-time visitor understands what MaC
// actually is, and that it's for founders and operators at any technical level
// (John: "a little more info, just enough to educate"). One compact section, no
// icon grid, so it stays boardy-clean.
export function PreviewProduct() {
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto w-full max-w-2xl px-6 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          What it is
        </p>
        <h2 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          Direct it like a teammate. It does the rest.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
          MaC is a team of agents that live in your Slack, remember your
          company, and do the work: shipping product, running ops, pulling
          research, closing leads. Built for founders and operators, technical
          or not. If you can describe it in a message, your agents can do it.
        </p>
      </div>
    </section>
  );
}
