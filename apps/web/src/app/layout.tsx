import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import { DemoBanner } from '@/components/DemoBanner';
import { ScanQrButton } from '@/components/ScanQr';
import { AccountLink } from '@/components/customer/AccountLink';
import './globals.css';

// Fallback for non-Apple devices; Apple devices use SF via -apple-system (see globals.css).
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Kagaz — print it, pick it up',
  description: 'Upload a PDF, pay, and collect your prints from a Mandya print shop.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1c1e' },
  ],
};

// The banner reads live config from the API on every request.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={inter.variable}>
      <body className="min-h-screen">
        {/* macOS-style translucent toolbar */}
        <header className="sticky top-0 z-40 border-b print:hidden border-separator bg-toolbar backdrop-blur-xl backdrop-saturate-150">
          <div className="mx-auto flex h-13 max-w-3xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grid size-7 place-items-center rounded-lg bg-accent text-sm font-bold text-white">
                K
              </span>
              <span className="text-[15px] font-semibold tracking-tight">Kagaz</span>
            </Link>
            <div className="flex items-center gap-2">
              <span className="hidden text-[13px] text-text-secondary sm:inline">Mandya</span>
              <ScanQrButton />
              <AccountLink />
            </div>
          </div>
          <DemoBanner />
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8 print:max-w-none print:p-0">{children}</main>
      </body>
    </html>
  );
}
