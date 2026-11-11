'use client';

/**
 * Admin building blocks on top of the shared macOS primitives (components/ui.tsx).
 * Wider layouts than the customer flow, same tokens.
 */
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { cx, Notice, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { useAdminSession } from './session';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="mac-title">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
  flush,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** No inner padding (tables). */
  flush?: boolean;
}) {
  return (
    <section className={cx('mac-card overflow-hidden', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-separator px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

export function Button({
  variant = 'secondary',
  busy,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
        'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-white hover:bg-accent-hover',
        variant === 'secondary' && 'border border-separator bg-surface hover:bg-selection',
        variant === 'danger' && 'border border-separator bg-surface text-red hover:bg-red/10',
        className,
      )}
    >
      {busy && <Spinner className="size-3" />}
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors disabled:opacity-40',
        checked ? 'bg-green' : 'bg-selection',
      )}
    >
      <span
        className={cx(
          'absolute size-[18px] rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

export function Input({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  className,
  hideLabel,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
  hideLabel?: boolean;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  min?: string;
  step?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={cx('mb-1 block text-[12px] text-text-secondary', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-separator bg-surface px-3 py-1.5 text-[14px] outline-none transition-shadow placeholder:text-text-secondary/70 focus:border-accent focus:ring-4 focus:ring-accent/20"
        {...rest}
      />
    </div>
  );
}

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  hideLabel,
  className,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  hideLabel?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={cx('mb-1 block text-[12px] text-text-secondary', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded-lg border border-separator bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:border-accent focus:ring-4 focus:ring-accent/20"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Plain table with hairlines; pass <th>/<td> rows. */
export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-separator text-left text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-separator">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  className,
  mono,
}: {
  children: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <td className={cx('px-4 py-2 align-middle', mono && 'font-mono text-[12px]', className)}>
      {children}
    </td>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-[13px] text-text-secondary">{children}</div>;
}

export function Loading() {
  return (
    <div className="flex items-center gap-2 py-10 text-[13px] text-text-secondary">
      <Spinner /> Loading…
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiRequestError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Something went wrong';
  return <Notice tone="red">{message}</Notice>;
}

/** Key/value grid for detail panes. */
export function Facts({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-[13px]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-text-secondary">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mac-card px-4 py-3">
      <div className="text-[12px] text-text-secondary">{label}</div>
      <div className="mt-1 text-[24px] font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-text-secondary">{hint}</div>}
    </div>
  );
}

/**
 * Load data on mount / when deps change; re-load with `reload()`. A 401 hands control back to
 * the session (login screen); other errors are returned for display.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const { onUnauthorized } = useAdminSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const value = await loadRef.current();
      if (mine === seq.current) {
        setData(value);
        setError(null);
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) onUnauthorized();
      if (mine === seq.current) setError(err);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void reload();
    // Caller-provided deps decide when to reload (reload itself is stable).
  }, deps);

  return { data, error, loading, reload, setData };
}

/** Run a mutation with busy/error state; 401 returns to the login screen. */
export function useAction() {
  const { onUnauthorized } = useAdminSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await fn();
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) onUnauthorized();
        setError(err);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [onUnauthorized],
  );
  return { busy, error, run, setError };
}
