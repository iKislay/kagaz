'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { type AdminMe } from '@kagaz/shared';
import { cx, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { adminApi } from '../../admin/_lib/api';
import { icons as adminIcons } from '../../admin/_components/icons';
import { AdminSessionContext, type AdminSession } from '../../admin/_components/session';
import { sudoIcons } from './icons';

const LOGIN = '/admin/login?next=/sudoadmin';

const NAV: { href: string; label: string; icon: ReactNode }[] = [
  { href: '/sudoadmin', label: 'Overview', icon: adminIcons.overview },
  { href: '/sudoadmin/shops', label: 'Shops', icon: adminIcons.shops },
  { href: '/sudoadmin/plans', label: 'Plans', icon: sudoIcons.plans },
  { href: '/sudoadmin/admins', label: 'Kagaz admins', icon: sudoIcons.admins },
];

/**
 * /sudoadmin window: the platform owner's console. Same session as /admin (kgz_admin cookie)
 * but only role ADMIN gets in — the API enforces this too (403 for everyone else).
 */
export function SudoShell({ banner, children }: { banner: ReactNode; children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [state, setState] = useState<'loading' | 'signed-out' | 'forbidden' | 'ready'>('loading');

  const load = useCallback(async () => {
    try {
      const who = await adminApi.me();
      setMe(who);
      setState(who.role === 'ADMIN' ? 'ready' : 'forbidden');
    } catch (err) {
      setMe(null);
      setState(err instanceof ApiRequestError && err.status === 401 ? 'signed-out' : 'forbidden');
    }
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (state === 'signed-out') router.replace(LOGIN);
  }, [state, router]);

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
      {(state === 'loading' || state === 'signed-out') && (
        <div className="grid flex-1 place-items-center text-text-secondary">
          <Spinner />
        </div>
      )}
      {state === 'forbidden' && (
        <div className="mx-auto mt-24 max-w-md px-4 text-center">
          <h1 className="mac-title">Kagaz admins only</h1>
          <p className="mt-2 text-[14px] text-text-secondary">
            This console is for the Kagaz team. Shop owners manage their shop from the dashboard.
          </p>
          <Link href="/admin" className="mt-4 inline-block text-[14px] text-accent">
            Go to the dashboard ›
          </Link>
        </div>
      )}
      {state === 'ready' && session && (
        <AdminSessionContext.Provider value={session}>
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <Sidebar me={session.me} onLogout={session.logout} />
            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</div>
            </main>
          </div>
        </AdminSessionContext.Provider>
      )}
    </div>
  );
}

function Sidebar({ me, onLogout }: { me: AdminMe; onLogout: () => Promise<void> }) {
  const pathname = usePathname();
  const active = (href: string) =>
    href === '/sudoadmin'
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);
  const item = 'flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px]';

  return (
    <aside className="shrink-0 border-b border-separator bg-sidebar backdrop-blur-xl backdrop-saturate-150 md:w-56 md:border-r md:border-b-0">
      <div className="flex h-full flex-col">
        <div className="hidden items-center gap-2.5 px-4 pt-4 pb-3 md:flex">
          <span className="grid size-7 place-items-center rounded-lg bg-text text-sm font-bold text-bg">
            K
          </span>
          <div className="leading-tight">
            <div className="text-[14px] font-semibold tracking-tight">Kagaz Console</div>
            <div className="text-[11px] text-text-secondary">Platform owner</div>
          </div>
        </div>
        <nav
          aria-label="Console sections"
          className="flex gap-0.5 overflow-x-auto px-2 py-2 md:flex-1 md:flex-col md:overflow-visible md:py-1"
        >
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? 'page' : undefined}
              className={cx(
                item,
                'transition-colors',
                active(n.href) ? 'bg-selection font-medium' : 'hover:bg-selection/60',
              )}
            >
              <span className={active(n.href) ? 'text-accent' : 'text-text-secondary'}>
                {n.icon}
              </span>
              {n.label}
            </Link>
          ))}
          <div className="my-2 hidden border-t border-separator md:block" />
          <Link href="/admin" className={cx(item, 'text-text-secondary hover:bg-selection/60')}>
            <span>{sudoIcons.external}</span>
            Operations dashboard
          </Link>
          <Link
            href="/admin/audit"
            className={cx(item, 'text-text-secondary hover:bg-selection/60')}
          >
            <span>{adminIcons.audit}</span>
            Audit log
          </Link>
        </nav>
        <div className="hidden border-t border-separator p-3 md:block">
          <div className="truncate text-[12px] font-medium">{me.name ?? me.email}</div>
          <div className="truncate text-[11px] text-text-secondary">{me.email}</div>
          <button
            type="button"
            onClick={() => void onLogout()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-text-secondary hover:bg-selection hover:text-text"
          >
            {adminIcons.logout} Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
