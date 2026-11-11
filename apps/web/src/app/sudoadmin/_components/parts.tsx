'use client';

import Link from 'next/link';
import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { Notice } from '@/components/ui';
import { Button, ErrorNote, Input, useAction } from '../../admin/_components/kit';

/** macOS-style sheet: a centered dialog over a dimmed window. Esc or backdrop closes it. */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/25 px-4 py-12 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`mac-card w-full ${wide ? 'max-w-xl' : 'max-w-md'} px-5 py-5`}
      >
        <h2 id={id} className="text-[17px] font-semibold tracking-tight">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-[13px] text-text-secondary">{subtitle}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/** Form body of a sheet: fields, error, Cancel + primary action. */
export function SheetForm({
  onSubmit,
  onCancel,
  submitLabel,
  busy,
  error,
  danger,
  disabled,
  children,
}: {
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
  submitLabel: string;
  busy?: boolean;
  error?: unknown;
  danger?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSubmit();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {children}
      <ErrorNote error={error} />
      <div className="mt-1 flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          type="submit"
          variant={danger ? 'danger' : 'primary'}
          busy={busy}
          disabled={disabled}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** A generated password, shown exactly once with a copy button. */
export function OneTimePassword({ login, password }: { login?: string | null; password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Notice tone="orange">
      <div className="text-[13px]">
        Temporary password{login ? ` for ${login}` : ''} — shown only once. Share it privately.
      </div>
      <div className="mt-2 flex items-center gap-2">
        <code className="rounded-md bg-surface px-2 py-1 font-mono text-[15px] tracking-wide text-text">
          {password}
        </code>
        <Button
          onClick={() => {
            void navigator.clipboard?.writeText(password).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </Notice>
  );
}

/** Multi-line text field in the admin kit style. */
export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[12px] text-text-secondary">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-lg border border-separator bg-surface px-3 py-1.5 text-[14px] outline-none placeholder:text-text-secondary/70 focus:border-accent focus:ring-4 focus:ring-accent/20"
      />
    </div>
  );
}

/** Set or generate a new password for an account; a generated one is shown once. */
export function ResetPasswordSheet({
  title,
  subtitle = 'The old password stops working at once.',
  login,
  reset,
  onClose,
}: {
  title: string;
  subtitle?: string;
  login: string | null;
  reset: (password?: string) => Promise<{ temporaryPassword: string | null }>;
  onClose: () => void;
}) {
  const { busy, error, run } = useAction();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState<{ temporaryPassword: string | null } | null>(null);

  if (done) {
    return (
      <Sheet title="Password changed" onClose={onClose}>
        {done.temporaryPassword ? (
          <OneTimePassword login={login} password={done.temporaryPassword} />
        ) : (
          <p className="text-[14px]">The new password is set.</p>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title={title} subtitle={subtitle} onClose={onClose}>
      <SheetForm
        submitLabel={password ? 'Set password' : 'Generate password'}
        busy={busy}
        error={error}
        onCancel={onClose}
        onSubmit={async () => {
          const r = await run(() => reset(password || undefined));
          if (r) setDone(r);
        }}
      >
        <Input
          label="New password (optional, at least 10 characters)"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          placeholder="Leave empty to generate"
        />
      </SheetForm>
    </Sheet>
  );
}

/** A link styled as the pill primary button. */
export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent/40"
    >
      {children}
    </Link>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[12px] text-text-secondary">{children}</p>;
}
