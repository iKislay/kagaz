'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  type LatLng,
  type ShopSummary,
  distanceKm,
  formatDistance,
  formatPaise,
} from '@kagaz/shared';
import { QrScanButton } from '@/components/customer/QrScanner';
import { Chevron, Dot, Group, Spinner } from '@/components/ui';

/** Only shops this close to the customer are listed. */
const NEARBY_KM = 5;

type Locate =
  { kind: 'locating' } | { kind: 'denied'; blocked: boolean } | { kind: 'located'; at: LatLng };

/**
 * Public shop list. Location is asked as soon as the page opens; once known, only shops within
 * NEARBY_KM are listed, nearest first. Denied → a "Use my location" button in place of the list.
 * In a shop, the customer scans its QR code instead (button above the list).
 */
export function ShopList({ shops }: { shops: ShopSummary[] }) {
  const [locate, setLocate] = useState<Locate>({ kind: 'locating' });

  function askLocation() {
    if (!('geolocation' in navigator)) return setLocate({ kind: 'denied', blocked: true });
    setLocate({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setLocate({ kind: 'located', at: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
      // PERMISSION_DENIED (1): the browser won't ask again until the site is allowed in settings.
      (err) => setLocate({ kind: 'denied', blocked: err.code === 1 }),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
    );
  }

  useEffect(askLocation, []);

  const nearby =
    locate.kind === 'located'
      ? shops
          .map((shop) => ({
            shop,
            km: shop.location ? distanceKm(locate.at, shop.location) : Infinity,
          }))
          .filter((r) => r.km <= NEARBY_KM)
          .sort((a, b) => a.km - b.km)
      : [];

  return (
    <>
      <div className="mac-card mt-6 flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">In a shop?</div>
          <div className="text-[13px] text-text-secondary">
            Scan the Kaggaz QR code at the counter.
          </div>
        </div>
        <QrScanButton />
      </div>

      <Group
        title="Print shops near you"
        footer={`Shops within ${NEARBY_KM} km. Prices are per printed side; you pay at the counter when you collect.`}
      >
        {locate.kind === 'locating' && (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-[14px] text-text-secondary">
            <Spinner /> Finding shops near you…
          </div>
        )}
        {locate.kind === 'denied' && (
          <div className="px-4 py-8 text-center">
            <p className="text-[14px] text-text-secondary">
              Share your location to see print shops near you.
            </p>
            <button type="button" onClick={askLocation} className="mac-button mt-3">
              Use my location
            </button>
            {locate.blocked && (
              <p className="mt-2 text-[12px] text-text-secondary">
                If nothing happens, allow location for kaggaz.in in your browser settings.
              </p>
            )}
          </div>
        )}
        {locate.kind === 'located' && nearby.length === 0 && (
          <div className="px-4 py-8 text-center text-[14px] text-text-secondary">
            No shops near you right now.
          </div>
        )}
        {nearby.map(({ shop, km }) => (
          <ShopRow key={shop.id} shop={shop} km={km} />
        ))}
      </Group>
    </>
  );
}

function ShopRow({ shop, km }: { shop: ShopSummary; km: number | null }) {
  const rates = shop.pricing
    ? [
        `B/W ${formatPaise(shop.pricing.monoRatePaise)}`,
        shop.capabilities.colour && `Colour ${formatPaise(shop.pricing.colourRatePaise)}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Prices not set';
  const extras = [shop.capabilities.duplex && 'Double-sided', shop.isDemo && 'Test shop']
    .filter(Boolean)
    .join(' · ');

  const body = (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-accent/12 text-[17px] font-bold text-accent">
        {shop.name.charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{shop.name}</div>
        <div className="truncate text-[13px] text-text-secondary">
          {km !== null && <span className="font-medium text-text">{formatDistance(km)} · </span>}
          {shop.address}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-text-secondary">
          {rates}
          {extras && ` · ${extras}`}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-text-secondary">
          <Dot tone={shop.acceptingOrders ? 'green' : 'neutral'} />
          {shop.acceptingOrders ? 'Open' : 'Not available right now'}
        </span>
        {shop.acceptingOrders && <Chevron />}
      </div>
    </div>
  );

  return shop.acceptingOrders ? (
    <Link
      href={`/order/new?shop=${shop.id}`}
      className="block transition-colors hover:bg-selection/60 active:bg-selection"
    >
      {body}
    </Link>
  ) : (
    <div aria-disabled className="opacity-55">
      {body}
    </div>
  );
}
