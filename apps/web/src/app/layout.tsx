import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { DemoBanner } from '@/components/DemoBanner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kagaz — print it, pick it up',
  description: 'Upload a PDF, pay, and collect your prints from a Mandya print shop.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// The banner reads live config from the API on every request.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen antialiased">
        <DemoBanner />
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-xl font-bold tracking-tight text-brand">
              Kagaz
            </Link>
            <span className="text-xs text-slate-500">Mandya</span>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
