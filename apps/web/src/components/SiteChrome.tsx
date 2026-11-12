import Image from 'next/image';
import Link from 'next/link';
import { DemoBanner } from '@/components/DemoBanner';
import { AccountLink } from '@/components/customer/AccountLink';
import { getPublicConfig } from '@/lib/api';

/** Shared header/footer and type styles for every customer-facing page. */
export const display = 'font-display font-semibold tracking-[-0.03em]';
export const eyebrow = 'font-mono text-[11px] uppercase tracking-[0.14em] text-ink-soft';
export const btnPrimary =
  'inline-flex h-11 items-center justify-center gap-2 rounded-full bg-forest px-6 text-[14px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_2px_rgba(13,110,79,0.22)] transition-colors hover:bg-forest-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-forest/30';
export const btnOutline =
  'inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line bg-paper px-6 text-[14px] font-medium text-ink transition-colors hover:bg-cream focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-forest/30';

const NAV = [
  ['How it works', '/#how-it-works'],
  ['For shops', '/#shops'],
  ['Pricing', '/#pricing'],
  ['FAQ', '/#faq'],
] as const;

function Logo() {
  return (
    <span className="grid size-7 place-items-center rounded-lg bg-forest text-sm font-bold text-white">
      K
    </span>
  );
}

export async function SiteHeader() {
  // OTP_PROVIDER=none: no customer sign-in, so no "Sign in" link (tracking links still work).
  const signInOn = await getPublicConfig().then(
    (c) => c.otpMode !== 'OFF',
    () => false,
  );
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-cream/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="Kagaz home">
          <Logo />
          <span className="text-[16px] font-semibold tracking-tight">Kagaz</span>
        </Link>
        <nav className="hidden items-center gap-0.5 md:flex">
          {NAV.map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="rounded-full px-3.5 py-1.5 text-[14px] font-medium text-ink-soft transition-colors hover:bg-black/[0.04] hover:text-ink"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          {signInOn && <AccountLink />}
          <Link href="/shops" className={`${btnPrimary} h-9 px-4 text-[13px]`}>
            Print a file
          </Link>
        </div>
      </div>
      <DemoBanner />
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative isolate overflow-hidden border-t border-line bg-cream">
      <div className="relative z-10 mx-auto max-w-6xl px-4 pt-16 pb-12 md:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2">
              <Logo />
              <span className="text-[16px] font-semibold tracking-tight">Kagaz</span>
            </div>
            <p className="mt-4 max-w-[34ch] text-[14px] leading-relaxed text-ink-soft">
              Upload from your phone, collect from a print shop in Mandya, Karnataka.
            </p>
          </div>
          <FooterCol
            title="Product"
            links={[
              ['How it works', '/#how-it-works'],
              ['Pricing', '/#pricing'],
              ['FAQ', '/#faq'],
            ]}
          />
          <FooterCol
            title="Customers"
            links={[
              ['Print a file', '/shops'],
              ['My orders', '/orders'],
              ['Sign in', '/signin'],
            ]}
          />
          <FooterCol
            title="Shops"
            links={[
              ['For print shops', '/#shops'],
              ['Download shop app', '/download'],
              ['Shop admin', '/admin'],
            ]}
          />
        </div>
        <div className="mt-12 flex flex-wrap justify-between gap-2 text-[12px] text-ink-soft">
          <span>© 2026 Kagaz. Mandya, Karnataka.</span>
          <span>Pay at the shop counter when you collect your prints.</span>
        </div>
      </div>
      {/* Pulled up under the links; the faded empty sky sits behind them. */}
      <div
        aria-hidden
        className="pointer-events-none relative z-0 mt-[calc(-3rem-8vw)] aspect-[2172/620] overflow-hidden select-none"
      >
        <Image
          src="/illustrations/footer.webp"
          alt=""
          width={2172}
          height={724}
          sizes="100vw"
          className="block h-auto w-full [mask-image:linear-gradient(to_bottom,transparent,black_22%)]"
        />
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className={eyebrow}>{title}</h4>
      <ul className="mt-4 space-y-2.5">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="text-[14px] text-ink hover:text-forest">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
