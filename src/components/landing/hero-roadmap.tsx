const roadmapStages = [
  { label: "Idea", active: true },
  { label: "Basic Interaction", active: true },
  { label: "Vertical Scaling", active: true },
  { label: "Testing", active: false },
  { label: "Launch", active: false },
  { label: "Iteration", active: false },
];

export function HeroRoadmap() {
  return (
    <div
      className="mx-auto mb-4 w-full max-w-3xl px-1 py-1 sm:mb-6"
      aria-label="Product roadmap progress"
    >
      <ol className="grid grid-cols-6 items-center gap-1.5 sm:gap-2" aria-hidden>
        {roadmapStages.map((stage, idx) => {
          const isLast = idx === roadmapStages.length - 1;
          return (
            <li key={stage.label} className="relative flex min-w-0 items-center justify-center">
              {!isLast && (
                <span
                  className="pointer-events-none absolute left-[58%] top-1/2 h-px w-[88%] -translate-y-1/2 bg-border/80"
                  aria-hidden
                />
              )}
              <span
                className={`relative z-10 h-2.5 w-2.5 rounded-full border ${
                  stage.active ? "border-foreground bg-foreground" : "border-border bg-background"
                } sm:h-3 sm:w-3`}
              />
            </li>
          );
        })}
      </ol>

      <ol className="mt-2.5 grid grid-cols-3 gap-x-2 gap-y-2 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-muted-foreground sm:mt-3 sm:grid-cols-6 sm:text-[0.72rem]">
        {roadmapStages.map((stage) => (
          <li key={`${stage.label}-label`} className="text-center leading-tight">
            {stage.label}
          </li>
        ))}
      </ol>
    </div>
  );
}
