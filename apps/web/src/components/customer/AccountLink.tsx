'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getMe } from '@/lib/customer-api';

/** Toolbar link: "My orders" when signed in, otherwise "Sign in" (P2.2). Fails soft. */
export function AccountLink() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMe().then(
      (c) => !cancelled && setSignedIn(c !== null),
      () => !cancelled && setSignedIn(false),
    );
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (signedIn === null || pathname.startsWith('/admin')) return null;
  return (
    <Link
      href={signedIn ? '/orders' : '/signin'}
      className="rounded-full px-3 py-1 text-[13px] font-semibold text-accent hover:bg-selection"
    >
      {signedIn ? 'My orders' : 'Sign in'}
    </Link>
  );
}
