import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { shopOrderPath } from '@kagaz/shared';
import { Notice } from '@/components/ui';
import { API_URL, listShops } from '@/lib/api';
import { PrintButton } from './PrintButton';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Shop QR poster — Kagaz' };

/**
 * Printable A4 poster with the shop's QR code (opened from the shop app → Shop QR → Print
 * poster). The sheet is sized in container units, so the on-screen preview and the printout
 * match. It always uses light "paper" colours, whatever the screen theme.
 */
export default async function ShopPosterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shops = await listShops().catch(() => null);
  if (!shops) return <Notice tone="red">Can’t reach Kagaz right now. Please try again.</Notice>;
  const shop = shops.find((s) => s.slug === slug);
  if (!shop) notFound();

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'kagaz';
  const shortLink = `${host}${shopOrderPath(shop.slug)}`;
  const qrSrc = `${API_URL}/shops/${encodeURIComponent(shop.slug)}/qr.svg`;

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="mac-title">Shop QR poster</h1>
          <p className="mt-1 text-[14px] text-text-secondary">
            A4, portrait. In the print dialog, turn off “Headers and footers” for a clean sheet.
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="poster-sheet mx-auto aspect-[210/297] w-full max-w-[210mm] overflow-hidden rounded-[12px] bg-white text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.10)] [container-type:inline-size] print:aspect-auto print:h-[297mm] print:w-[210mm] print:max-w-none print:rounded-none print:shadow-none">
        <div className="flex h-full flex-col px-[7cqw] pt-[6cqw] pb-[5cqw]">
          {/* Brand */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-[1.6cqw]">
              <span className="grid size-[5.4cqw] place-items-center rounded-[1.4cqw] bg-[#007AFF] text-[3cqw] font-bold text-white">
                K
              </span>
              <span className="text-[3.2cqw] font-semibold tracking-tight">Kagaz</span>
            </div>
            <span className="rounded-full bg-[#007AFF]/10 px-[2.2cqw] py-[0.8cqw] text-[2.2cqw] font-semibold text-[#007AFF]">
              Print from your phone
            </span>
          </div>

          {/* Headline */}
          <h2 className="mt-[6cqw] text-center text-[8.4cqw] leading-[1.02] font-bold tracking-[-0.03em]">
            Scan to print here
          </h2>
          <p className="mx-auto mt-[2cqw] max-w-[70cqw] text-center text-[3.1cqw] leading-snug text-[#6e6e73]">
            Send your PDF from your phone. Pay at the counter and pick up your prints.
          </p>

          {/* QR with corner brackets */}
          <div className="relative mx-auto mt-[5cqw] w-[56cqw]">
            {CORNERS.map((corner) => (
              <span
                key={corner.key}
                aria-hidden
                className="absolute size-[9cqw] border-solid border-[#007AFF]"
                style={corner.style}
              />
            ))}
            <div className="p-[3.2cqw]">
              <img
                src={qrSrc}
                alt={`QR code to order from ${shop.name}`}
                className="block aspect-square w-full"
              />
            </div>
          </div>

          {/* Shop */}
          <div className="mt-[3.4cqw] text-center">
            <div className="text-[5cqw] leading-tight font-bold tracking-[-0.02em]">
              {shop.name}
            </div>
            <div className="mt-[0.8cqw] text-[2.7cqw] text-[#6e6e73]">{shop.address}</div>
          </div>

          {/* Steps */}
          <ol className="mt-auto grid grid-cols-3 gap-[3cqw] border-t border-black/10 pt-[4cqw]">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <span className="grid size-[5cqw] place-items-center rounded-full bg-[#007AFF] text-[2.6cqw] font-bold text-white">
                  {i + 1}
                </span>
                <div className="mt-[1.4cqw] text-[2.7cqw] font-semibold">{step.title}</div>
                <div className="mt-[0.5cqw] text-[2.2cqw] leading-snug text-[#6e6e73]">
                  {step.text}
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-[4cqw] flex items-center justify-between text-[2cqw] text-[#6e6e73]">
            <span>
              No app needed · or open{' '}
              <span className="font-semibold text-[#1d1d1f]">{shortLink}</span>
            </span>
            <span>PDF only · A4</span>
          </div>
        </div>
      </div>
    </section>
  );
}

const EDGE = '0.9cqw';
const ROUND = '2.4cqw';
/** Accent brackets around the QR (camera-viewfinder look). */
const CORNERS = [
  {
    key: 'tl',
    style: {
      top: 0,
      left: 0,
      borderTopWidth: EDGE,
      borderLeftWidth: EDGE,
      borderTopLeftRadius: ROUND,
    },
  },
  {
    key: 'tr',
    style: {
      top: 0,
      right: 0,
      borderTopWidth: EDGE,
      borderRightWidth: EDGE,
      borderTopRightRadius: ROUND,
    },
  },
  {
    key: 'bl',
    style: {
      bottom: 0,
      left: 0,
      borderBottomWidth: EDGE,
      borderLeftWidth: EDGE,
      borderBottomLeftRadius: ROUND,
    },
  },
  {
    key: 'br',
    style: {
      bottom: 0,
      right: 0,
      borderBottomWidth: EDGE,
      borderRightWidth: EDGE,
      borderBottomRightRadius: ROUND,
    },
  },
] as const;

const STEPS = [
  { title: 'Scan', text: 'Open your phone camera and point it at the code.' },
  { title: 'Upload & choose', text: 'Pick your PDF, copies and B/W or colour. See the price.' },
  {
    title: 'Pay & collect',
    text: 'Pay at the counter with your pickup number. Collect your prints with it.',
  },
] as const;
