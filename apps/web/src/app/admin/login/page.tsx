'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Notice, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { adminApi } from '../_lib/api';

/**
 * Admin sign-in (PRD §11.3, FR-ADMIN-01, P2.3).
 *
 * The session is an httpOnly `kgz_admin` cookie set by POST /api/admin/auth/login
 * (sent with credentials: 'include'). This page is what every unauthenticated
 * /admin/* visit is redirected to.
 */
/** Where to go after sign-in: `?next=` if it's one of our staff areas, else /admin. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get('next') ?? '';
  return /^\/(admin|sudoadmin)(\/[\w\-/]*)?$/.test(next) ? next : '/admin';
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in? Skip the form.
  useEffect(() => {
    let cancelled = false;
    void adminApi
      .me()
      .then(() => {
        if (!cancelled) router.replace(nextPath());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.login(login.trim(), password);
      setPassword('');
      router.replace(nextPath());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-4 py-10">
      <form onSubmit={submit} className="mac-card w-full max-w-sm px-6 py-7" aria-label="Sign in">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-accent text-lg font-bold text-white">
            K
          </span>
          <h1 className="text-[20px] font-semibold tracking-tight">Kagaz Admin</h1>
          <p className="text-[13px] text-text-secondary">Sign in with your staff account.</p>
        </div>
        <label className="mb-1 block text-[12px] text-text-secondary" htmlFor="admin-login">
          Email or phone
        </label>
        <input
          id="admin-login"
          name="login"
          autoComplete="username"
          autoFocus
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          className="mb-3 w-full rounded-lg border border-separator bg-surface px-3 py-2 text-[14px] outline-none focus:border-accent focus:ring-4 focus:ring-accent/20"
        />
        <label className="mb-1 block text-[12px] text-text-secondary" htmlFor="admin-password">
          Password
        </label>
        <input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-separator bg-surface px-3 py-2 text-[14px] outline-none focus:border-accent focus:ring-4 focus:ring-accent/20"
        />
        {error && <Notice tone="red">{error}</Notice>}
        <button
          type="submit"
          disabled={busy || !login || !password}
          className="mac-button mt-5 w-full disabled:opacity-50"
        >
          {busy ? <Spinner className="size-3.5" /> : null}
          Sign in
        </button>
      </form>
    </div>
  );
}
