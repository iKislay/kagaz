'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { type AdminMe } from '@kagaz/shared';
import { cx, Notice, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { adminApi } from '../_lib/api';
import { icons } from './icons';
import { AdminSessionContext, type AdminSession } from './session';

const NAV: { href: string; label: string; icon: ReactNode; adminOnly: boolean }[] = [
  { href: '/admin', label: 'Overview', icon: icons.overview, adminOnly: true },
  { href: '/admin/shops', label: 'Shops', icon: icons.shops, adminOnly: false },
  { href: '/admin/orders', label: 'Orders', icon: icons.orders, adminOnly: true },
  { href: '/admin/health', label: 'Health', icon: icons.health, adminOnly: true },
  {
    href: '/admin/reconciliation',
    label: 'Reconciliation',
    icon: icons.reconciliation,
    adminOnly: true,
  },
  { href: '/admin/audit', label: 'Audit log', icon: icons.audit, adminOnly: true },
  { href: '/admin/demo', label: 'Demo controls', icon: icons.demo, adminOnly: true },
];

/**
 * macOS-style window for /admin: translucent source-list sidebar + content area, covering the
 * customer toolbar. The DEMO banner stays visible at the top (invariant 4).
 */
export function AdminShell({ banner, children }: { banner: ReactNode; children: ReactNode }) {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready'>('loading');

  const load = useCallback(async () => {
    try {
      setMe(await adminApi.me());
      setState('ready');
    } catch {
      setMe(null);
      setState('signed-out');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const session = useMemo<AdminSession | null>(
    () =>
      me
        ? {
            me,
            onUnauthorized: () => {
              setMe(null);
              setState('signed-out');
            },
            logout: async () => {
              await adminApi.logout().catch(() => undefined);
              setMe(null);
              setState('signed-out');
            },
          }
        : null,
    [me],
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg text-text">
      {banner}
      {state === 'loading' && (
        <div className="grid flex-1 place-items-center text-text-secondary">
          <Spinner />
        </div>
      )}
      {state === 'signed-out' && <SignIn onSignedIn={load} />}
      {state === 'ready' && session && (
        <AdminSessionContext.Provider value={session}>
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <Sidebar me={session.me} onLogout={session.logout} />
            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
                {session.me.role === 'SHOP_OPERATOR' ? <OperatorNotice /> : children}
              </div>
            </main>
          </div>
        </AdminSessionContext.Provider>
      )}
    </div>
  );
}

function Sidebar({ me, onLogout }: { me: AdminMe; onLogout: () => Promise<void> }) {
  const pathname = usePathname();
  const items = NAV.filter((n) => me.role === 'ADMIN' || !n.adminOnly);
  const active = (href: string) =>
    href === '/admin'
      ? pathname === '/admin'
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="shrink-0 border-b border-separator bg-sidebar backdrop-blur-xl backdrop-saturate-150 md:w-56 md:border-r md:border-b-0">
      <div className="flex h-full flex-col">
        <div className="hidden items-center gap-2.5 px-4 pt-4 pb-3 md:flex">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-sm font-bold text-white">
            K
          </span>
          <div className="leading-tight">
            <div className="text-[14px] font-semibold tracking-tight">Kagaz Admin</div>
            <div className="text-[11px] text-text-secondary">
              {me.role === 'ADMIN' ? 'Platform admin' : 'Shop owner'}
            </div>
          </div>
        </div>
        <nav
          aria-label="Admin sections"
          className="flex gap-0.5 overflow-x-auto px-2 py-2 md:flex-1 md:flex-col md:overflow-visible md:py-1"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(item.href) ? 'page' : undefined}
              className={cx(
                'flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                active(item.href)
                  ? 'bg-selection font-medium text-text'
                  : 'text-text hover:bg-selection/60',
              )}
            >
              <span className={active(item.href) ? 'text-accent' : 'text-text-secondary'}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => void onLogout()}
            className="flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-text-secondary hover:bg-selection/60 md:hidden"
          >
            {icons.logout} Sign out
          </button>
        </nav>
        <div className="hidden border-t border-separator p-3 md:block">
          <div className="truncate text-[12px] font-medium">{me.name ?? me.email ?? me.phone}</div>
          <div className="truncate text-[11px] text-text-secondary">{me.email}</div>
          <button
            type="button"
            onClick={() => void onLogout()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-text-secondary hover:bg-selection hover:text-text"
          >
            {icons.logout} Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}

function OperatorNotice() {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h1 className="mac-title">Use the shop app</h1>
      <p className="mt-2 text-[14px] text-text-secondary">
        Operators work from the Kagaz app on the shop PC. Ask your shop owner or a Kagaz admin if
        you need dashboard access.
      </p>
    </div>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.login(login.trim(), password);
      setPassword('');
      await onSignedIn();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid flex-1 place-items-center overflow-y-auto px-4 py-10">
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
          autoComplete="username"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          className="mb-3 w-full rounded-lg border border-separator bg-surface px-3 py-2 text-[14px] outline-none focus:border-accent focus:ring-4 focus:ring-accent/20"
        />
        <label className="mb-1 block text-[12px] text-text-secondary" htmlFor="admin-password">
          Password
        </label>
        <input
          id="admin-password"
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
