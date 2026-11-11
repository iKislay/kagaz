/** Illustrative product mockups (pure HTML/CSS, no screenshots) in the shared macOS look. */

const dot = {
  green: 'bg-green',
  orange: 'bg-orange',
  accent: 'bg-accent',
  neutral: 'bg-text-secondary',
};

const JOBS: {
  code: string;
  ref: string;
  detail: string;
  status: string;
  tone: keyof typeof dot;
}[] = [
  {
    code: '#9',
    ref: 'Notes_Unit3.pdf',
    detail: '12 pages · B/W · 2 copies',
    status: 'Queued',
    tone: 'neutral',
  },
  {
    code: '#8',
    ref: 'Resume_final.pdf',
    detail: '2 pages · Colour',
    status: 'Printing',
    tone: 'accent',
  },
  {
    code: '#7',
    ref: 'Lab_record.pdf',
    detail: '24 pages · B/W · Double-sided',
    status: 'Ready',
    tone: 'green',
  },
  {
    code: '#6',
    ref: 'Admit_card.pdf',
    detail: '1 page · B/W',
    status: 'Collected',
    tone: 'neutral',
  },
];

/** The Kaggaz Shop app job list, as a window. */
export function ShopWindow() {
  return (
    <div className="mac-card overflow-hidden text-left">
      <div className="flex items-center justify-between border-b border-separator bg-sidebar px-4 py-2.5">
        <span className="text-[13px] font-semibold">Kaggaz Shop · Jobs</span>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
          <span className="size-1.5 rounded-full bg-green" /> Auto mode on
        </span>
      </div>
      <ul className="divide-y divide-separator">
        {JOBS.map((j) => (
          <li key={j.code} className="flex items-center gap-3 px-4 py-3">
            <span className="grid h-9 w-11 shrink-0 place-items-center rounded-[8px] bg-selection text-[15px] font-bold tabular-nums">
              {j.code}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{j.ref}</div>
              <div className="truncate text-[12px] text-text-secondary">{j.detail}</div>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-text-secondary">
              <span className={`size-2 rounded-full ${dot[j.tone]}`} />
              {j.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Customer order page on a phone. */
export function PhoneTracker() {
  const steps = ['Paid', 'Queued', 'Printing', 'Ready'];
  return (
    <div className="w-[220px] rounded-[30px] border border-separator bg-surface p-2.5 shadow-card">
      <div className="rounded-[22px] bg-bg px-4 pb-5 pt-6 text-center">
        <div className="text-[11px] font-medium text-text-secondary">Pickup code</div>
        <div className="mt-1 text-[40px] font-bold leading-none tracking-tight tabular-nums">
          #7
        </div>
        <div className="mt-1 text-[12px] text-text-secondary">11 Nov · Demo Shop A</div>
        <div className="mt-4 rounded-xl bg-green/15 px-3 py-2 text-[12px] font-semibold text-green">
          Printed — ready to collect
        </div>
        <ol className="mt-4 space-y-2 text-left">
          {steps.map((s) => (
            <li key={s} className="flex items-center gap-2 text-[12px]">
              <span className="grid size-4 place-items-center rounded-full bg-green text-white">
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                >
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              </span>
              {s}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** A stack of A4 pages with the pickup slip on top. */
export function PacketStack() {
  return (
    <div className="relative mx-auto h-[300px] w-[230px]">
      {[2, 1].map((i) => (
        <div
          key={i}
          className="absolute inset-0 rounded-[6px] border border-separator bg-surface shadow-card"
          style={{ transform: `translate(${i * 14}px, ${i * -12}px) rotate(${i * 2.5}deg)` }}
        >
          <div className="space-y-2 p-6">
            {Array.from({ length: 9 }, (_, k) => (
              <div
                key={k}
                className="h-1.5 rounded-full bg-selection"
                style={{ width: `${70 + ((k * 37) % 30)}%` }}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="absolute inset-0 flex flex-col rounded-[6px] border border-separator bg-surface p-6 shadow-card">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary">
          Kaggaz · Pickup slip
        </div>
        <div className="mt-6 text-center">
          <div className="text-[64px] font-bold leading-none tracking-tight tabular-nums">#7</div>
          <div className="mt-2 text-[15px] font-semibold">11 Nov</div>
        </div>
        <dl className="mt-auto space-y-1.5 border-t border-dashed border-separator pt-3 text-[11px]">
          {[
            ['Order', 'KGZ-4F7Q2'],
            ['Pages', '24 · B/W · Double-sided'],
            ['Copies', '1'],
            ['Phone', '••••••3210'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-text-secondary">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
