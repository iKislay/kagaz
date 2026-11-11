import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import './globals.css';

// Fallback for non-Apple devices; Apple devices use SF via -apple-system (see globals.css).
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://kaggaz.app'),
  title: {
    default: 'Kaggaz — prepaid print orders for your print shop',
    template: '%s · Kaggaz',
  },
  description:
    'Customers upload a PDF and pay online. Kaggaz prints it on your shop printer with a pickup slip, ready to collect.',
  openGraph: {
    title: 'Kaggaz — prepaid print orders for your print shop',
    description:
      'Customers upload a PDF and pay online. Kaggaz prints it on your shop printer with a pickup slip.',
    url: 'https://kaggaz.app',
    siteName: 'Kaggaz',
    locale: 'en_IN',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1c1e' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={inter.variable}>
      <body className="min-h-screen">
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
