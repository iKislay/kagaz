'use client';

/**
 * macOS-style UI primitives (CLAUDE.md "Design language"). Keep every screen built from
 * these so the website, admin and Windows app stay visually consistent.
 */
import { type ReactNode, useId } from 'react';
import { type Tone } from '@/lib/status';

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

/** System Settings–style inset grouped list. */
export function Group({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-6">
      {title && (
        <h2 className="mb-1.5 px-4 text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
          {title}
        </h2>
      )}
      <div className="mac-card divide-y divide-separator overflow-hidden">{children}</div>
      {footer && <div className="mt-1.5 px-4 text-[12px] text-text-secondary">{footer}</div>}
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
  disabled,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div
      className={cx(
        'flex min-h-12 items-center justify-between gap-4 px-4 py-2.5',
        disabled && 'opacity-50',
      )}
    >
      <div className="min-w-0">
        <div className="text-[15px]">{label}</div>
        {hint && <div className="text-[12px] text-text-secondary">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-selection p-0.5">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              'min-w-16 rounded-md px-3 py-1 text-[13px] font-medium transition-all',
              selected ? 'bg-surface shadow-sm' : 'text-text-secondary hover:text-text',
              'disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
}) {
  const btn =
    'grid size-8 place-items-center text-lg text-accent transition-colors hover:bg-selection disabled:text-text-secondary disabled:opacity-40';
  return (
    <div className="inline-flex items-center overflow-hidden rounded-lg border border-separator bg-surface">
      <button
        type="button"
        className={btn}
        aria-label={`Fewer ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span className="w-9 text-center text-[15px] font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={btn}
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  error,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  inputMode?: 'text' | 'numeric';
}) {
  const id = useId();
  return (
    <div className="w-44">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        className={cx(
          'w-full rounded-lg border bg-surface px-3 py-1.5 text-right text-[15px] outline-none transition-shadow',
          'placeholder:text-text-secondary/70 focus:ring-4 focus:ring-accent/20',
          error ? 'border-red' : 'border-separator focus:border-accent',
        )}
      />
    </div>
  );
}

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-selection text-text-secondary',
  accent: 'bg-accent/12 text-accent',
  green: 'bg-green/15 text-green',
  orange: 'bg-orange/15 text-orange',
  red: 'bg-red/12 text-red',
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold',
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  const color = {
    neutral: 'bg-text-secondary',
    accent: 'bg-accent',
    green: 'bg-green',
    orange: 'bg-orange',
    red: 'bg-red',
  }[tone];
  return <span className={cx('inline-block size-2 rounded-full', color)} />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
    />
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-selection"
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-200"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: 'red' | 'orange' | 'green' | 'accent';
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'red' ? 'alert' : 'status'}
      className={cx('mt-4 rounded-xl px-4 py-3 text-[14px]', toneClasses[tone])}
    >
      {children}
    </div>
  );
}

export function Chevron() {
  return (
    <svg aria-hidden width="8" height="13" viewBox="0 0 8 13" className="text-text-secondary/60">
      <path
        d="M1.5 1.5 6.5 6.5l-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export { cx };
