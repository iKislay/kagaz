import type { Metadata } from 'next';
import Link from 'next/link';
import { btnOutline, btnPrimary, display, eyebrow } from '@/components/SiteChrome';
import { API_URL } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Kagaz Shop for Windows — for print shops',
  description: 'Download the Kagaz Shop Windows app. For print-shop owners and operators only.',
};

// Uploaded to R2 by .github/workflows/shop-agent-release.yml; the API redirects to a signed URL of the newest build.
const SETUP_URL = `${API_URL}/downloads/shop-agent/KagazShop-win-Setup.exe`;

const STEPS = [
  'Download the installer and run it on the shop PC as your normal Windows user. No admin rights needed.',
  'If Windows says “Windows protected your PC”, click More info → Run anyway. The app is not code-signed yet.',
  'Enter the one-time pairing code from the Kagaz admin. The server address is already filled in.',
  'Sign in as an operator, confirm your printer (colour / double-sided), and print a test order.',
];

export default function DownloadPage() {
  return (
    <section>
      <p className={eyebrow}>For print shops</p>
      <h1 className={`${display} mt-4 text-[34px] leading-[1.1] md:text-[40px]`}>
        Kagaz Shop for Windows
      </h1>
      <p className="mt-3 max-w-[56ch] text-[16px] leading-relaxed text-ink-soft">
        The app for <strong className="font-medium text-ink">shop owners and operators</strong>. It
        runs on your shop PC, receives paid orders and prints them on your printer with a pickup
        slip.
      </p>

      <div className="mt-6 rounded-2xl border border-line bg-cream p-5">
        <p className="text-[15px] font-medium">Want to print a file?</p>
        <p className="mt-1 text-[14px] text-ink-soft">
          You don’t need this app. Upload from your phone at{' '}
          <Link
            href="/shops"
            className="font-medium text-forest underline-offset-2 hover:underline"
          >
            kaggaz.in/shops
          </Link>
          .
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <a href={SETUP_URL} className={btnPrimary}>
          Download for Windows
        </a>
        <Link href="/shops" className={btnOutline}>
          I want to print a file
        </Link>
      </div>
      <p className="mt-3 text-[13px] text-ink-soft">
        Windows 10 or 11, 64-bit · about 80 MB · updates itself automatically
      </p>

      <h2 className="mt-12 text-[18px] font-medium tracking-[-0.015em]">Install</h2>
      <ol className="mt-4 space-y-3">
        {STEPS.map((step, i) => (
          <li key={step} className="flex gap-3 text-[14px] leading-relaxed text-ink-soft">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-forest/10 text-[12px] font-semibold text-forest">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}
