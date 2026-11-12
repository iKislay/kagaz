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
import { Chevron, Dot, Group } from '@/components/ui';

/** Shops further than this from the customer are hidden once we know where they are. */
const NEARBY_KM = 5;

type Locate = { kind: 'idle' | 'locating' | 'denied' } | { kind: 'located'; at: LatLng };

/** Public shop list; "Near me" sorts by distance from the customer's location (asked on tap only). */
export function ShopList({ shops }: { shops: ShopSummary[] }) {
  const [locate, setLocate] = useState<Locate>({ kind: 'idle' });
  const [showAll, setShowAll] = useState(false);

  function findNearMe() {
    if (!navigator.geolocation) return setLocate({ kind: 'denied' });
    setLocate({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setLocate({ kind: 'located', at: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
      () => setLocate({ kind: 'denied' }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  // Already allowed location before? Sort straight away instead of waiting for a tap.
  useEffect(() => {
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((p) => p.state === 'granted' && findNearMe())
      .catch(() => {});
  }, []);

  const here = locate.kind === 'located' ? locate.at : null;
  const all = shops.map((shop) => ({
    shop,
    km: here && shop.location ? distanceKm(here, shop.location) : null,
  }));
  // Located: only shops within NEARBY_KM, nearest first (no location set = can't confirm it's near).
  const rows =
    here && !showAll
      ? all.filter((r) => r.km !== null && r.km <= NEARBY_KM).sort((a, b) => a.km! - b.km!)
      : all.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={findNearMe}
          disabled={locate.kind === 'locating'}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-separator bg-surface px-4 text-[13px] font-medium text-accent transition-colors hover:bg-selection disabled:opacity-60"
        >
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="8" cy="8" r="2.5" />
            <path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" strokeLinecap="round" />
          </svg>
          {locate.kind === 'locating'
            ? 'Finding you…'
            : here
              ? `Within ${NEARBY_KM} km, nearest first`
              : 'Shops near me'}
        </button>
        <span className="text-[13px] text-text-secondary">
          {locate.kind === 'denied'
            ? 'Couldn’t get your location. Pick a shop below.'
            : 'In a shop? Scan the Kagaz QR code at the counter.'}
        </span>
      </div>

      <Group
        title={here && !showAll ? 'Print shops near you' : 'Print shops'}
        footer="Prices are per printed side. The shop prints only after you pay."
      >
        {rows.length === 0 && (
          <div className="px-4 py-6 text-center text-[14px] text-text-secondary">
            {here && !showAll ? (
              <>
                No Kagaz shops within {NEARBY_KM} km of you yet.{' '}
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="font-medium text-accent"
                >
                  Show all shops
                </button>
              </>
            ) : (
              'No shops yet.'
            )}
          </div>
        )}
        {rows.map(({ shop, km }) => (
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
  const extras = [shop.capabilities.duplex && 'Double-sided', shop.isDemo && 'Demo shop']
    .filter(Boolean)
    .join(' · ');

  const body = (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-accent/12 text-[17px] font-bold text-accent">
        {shop.name.replace(/^Kagaz Demo Shop /, '').charAt(0)}
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
