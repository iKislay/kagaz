import type { Metadata } from 'next';
import { DownloadButton } from '@/components/DownloadButton';
import { icons, Logo } from '@/components/icons';
import { CONTACT_HREF, SHOP_APP_DOWNLOAD_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Download Kaggaz Shop for Windows',
  description:
    'The Kaggaz Shop app receives paid print orders and prints them on your shop printer.',
};

const REQUIREMENTS = [
  'Windows 10 or 11, 64-bit',
  'Internet connection',
  'A printer installed in Windows, loaded with A4 paper',
  'No admin rights needed — installs for the current user',
];

const SETUP: { title: string; body: string }[] = [
  {
    title: 'Install',
    body: 'Run KagazShop-win-Setup.exe. If Windows shows “Windows protected your PC”, click More info → Run anyway.',
  },
  {
    title: 'Pair this PC',
    body: 'Enter the one-time pairing code from the Kaggaz team. It works once and expires after 30 minutes.',
  },
  {
    title: 'Pick your printer',
    body: 'Open Printers, tick the printer to use, and confirm whether it prints colour and double-sided.',
  },
  {
    title: 'Take orders',
    body: 'Paid orders appear under Jobs. Turn on auto mode to print jobs within your limits by themselves.',
  },
];

export default function DownloadPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="text-center">
        <div className="mx-auto w-fit">
          <Logo size={64} />
        </div>
        <h1 className="mt-6 text-[clamp(32px,5vw,44px)] font-bold leading-tight tracking-[-0.03em]">
          Kaggaz Shop for Windows
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-[17px] text-text-secondary">
          Receives paid print orders and prints them on your shop printer, each with its pickup
          slip. Updates itself automatically.
        </p>
        <div className="mt-8 flex justify-center">
          <DownloadButton />
        </div>
        <p className="mt-3 text-[13px] text-text-secondary">
          {SHOP_APP_DOWNLOAD_URL
            ? 'Free download · 64-bit installer'
            : 'The installer will be available here shortly.'}
        </p>
      </div>

      <section className="mt-16">
        <h2 className="px-4 text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
          What you need
        </h2>
        <ul className="mac-card mt-2 divide-y divide-separator overflow-hidden">
          {REQUIREMENTS.map((r) => (
            <li key={r} className="flex items-center gap-3 px-4 py-3 text-[15px]">
              <span className="text-green">{icons.check}</span>
              {r}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="px-4 text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
          Set up in four steps
        </h2>
        <ol className="mac-card mt-2 divide-y divide-separator overflow-hidden">
          {SETUP.map((s, i) => (
            <li key={s.title} className="flex gap-4 px-4 py-4">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent/10 text-[13px] font-semibold text-accent">
                {i + 1}
              </span>
              <div>
                <div className="text-[15px] font-semibold">{s.title}</div>
                <p className="mt-0.5 text-[14px] leading-relaxed text-text-secondary">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 px-4 text-[13px] text-text-secondary">
          Need a pairing code or help with your printer?{' '}
          <a href={CONTACT_HREF} className="font-medium text-accent hover:underline">
            Talk to us
          </a>
          .
        </p>
      </section>
    </div>
  );
}
