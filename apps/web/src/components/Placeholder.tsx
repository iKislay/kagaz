/** Temporary page body for routes that are scaffolded in Phase 0 and built in Phase 1. */
export function Placeholder({
  title,
  stage,
  children,
}: {
  title: string;
  stage: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 bg-white p-6">
      <h1 className="text-lg font-semibold text-brand-ink">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">Coming in stage {stage}.</p>
      {children}
    </section>
  );
}
