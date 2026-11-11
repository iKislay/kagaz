import Link from 'next/link';
import { BRAND, CUSTOMER_APP_URL } from '@/lib/site';
import { Logo } from './icons';

const NAV = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#shops', label: 'For shops' },
  { href: '/#customers', label: 'For customers' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
];

/** macOS-style translucent toolbar. */
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-separator bg-toolbar backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[16px] font-semibold tracking-tight">{BRAND}</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-full px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-selection hover:text-text"
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/download/"
            className="hidden rounded-full px-3 py-1.5 text-[13px] font-semibold text-accent hover:bg-selection sm:inline-flex"
          >
            Download
          </Link>
          <a href={CUSTOMER_APP_URL} className="btn-primary !px-4 !py-1.5 !text-[13px]">
            Start printing
          </a>
        </div>
      </div>
    </header>
  );
}
