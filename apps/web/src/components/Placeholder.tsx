/** Temporary page body for routes that are scaffolded but built in a later stage. */
export function Placeholder({
  title,
  subtitle,
  stage,
  children,
}: {
  title: string;
  subtitle?: string;
  stage: string;
  children?: React.ReactNode;
}) {
  return (
    <section>
      <h1 className="mac-title">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[15px] text-text-secondary">{subtitle}</p>}
      <div className="mac-card mt-6 p-6">
        <p className="text-[15px] font-semibold">Coming in stage {stage}</p>
        <p className="mt-1 text-[13px] text-text-secondary">
          This screen is part of the investor demo vertical slice.
        </p>
        {children}
      </div>
    </section>
  );
}
