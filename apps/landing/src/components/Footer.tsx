import Link from 'next/link';
import { BRAND, CONTACT_EMAIL, CONTACT_PHONE, CUSTOMER_APP_URL } from '@/lib/site';
import { Logo } from './icons';

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/#how-it-works', label: 'How it works' },
      { href: '/#shops', label: 'For print shops' },
      { href: '/#customers', label: 'For customers' },
      { href: '/#pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Get started',
    links: [
      { href: CUSTOMER_APP_URL, label: 'Order a print' },
      { href: '/download/', label: 'Download the shop app' },
      { href: '/#faq', label: 'FAQ' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-separator">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <Logo size={24} />
            <span className="text-[15px] font-semibold tracking-tight">{BRAND}</span>
          </div>
          <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-text-secondary">
            Prepaid print orders for neighbourhood print shops. Upload, pay, print, pick up.
            Starting in Mandya, Karnataka.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
              {c.title}
            </h3>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l.label}>
                  {l.href.startsWith('/') ? (
                    <Link href={l.href} className="text-[14px] hover:text-accent">
                      {l.label}
                    </Link>
                  ) : (
                    <a href={l.href} className="text-[14px] hover:text-accent">
                      {l.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
            Contact
          </h3>
          <ul className="mt-3 space-y-2 text-[14px]">
            <li className="text-text-secondary">Mandya, Karnataka</li>
            {CONTACT_EMAIL && (
              <li>
                <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-accent">
                  {CONTACT_EMAIL}
                </a>
              </li>
            )}
            {CONTACT_PHONE && (
              <li>
                <a href={`tel:${CONTACT_PHONE.replace(/\s+/g, '')}`} className="hover:text-accent">
                  {CONTACT_PHONE}
                </a>
              </li>
            )}
          </ul>
        </div>
      </div>
      <div className="border-t border-separator">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-5 text-[12px] text-text-secondary sm:flex-row sm:justify-between sm:px-6">
          <span>
            © {new Date().getFullYear()} {BRAND}. All rights reserved.
          </span>
          <span>Made for print shops in India.</span>
        </div>
      </div>
    </footer>
  );
}
