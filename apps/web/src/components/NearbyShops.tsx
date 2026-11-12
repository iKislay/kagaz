'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type GeoPoint,
  type ShopSummary,
  distanceKm,
  formatDistance,
  formatPaise,
} from '@kagaz/shared';
import { Chevron, Dot, Group, Spinner } from '@/components/ui';

type Locate = 'idle' | 'locating' | 'ok' | 'denied' | 'unsupported';

/**
 * "Print shops near you" (customer home). With the customer's permission the list is sorted by
 * distance (open shops first), otherwise it stays alphabetical. Location is used only in the
 * browser to sort; it is never sent to Kagaz.
 */
export function NearbyShops({ shops }: { shops: ShopSummary[] }) {
  const [state, setState] = useState<Locate>('idle');
  const [here, setHere] = useState<GeoPoint | null>(null);

  const locate = useCallback(() => {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      setState('unsupported');
      return;
    }
    setState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHere({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setState('ok');
      },
      () => setState('denied'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }, []);

  // Already allowed before? Sort straight away without asking again.
  useEffect(() => {
    let cancelled = false;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((p) => !cancelled && p.state === 'granted' && locate())
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [locate]);

  const rows = useMemo(() => {
    const withDistance = shops.map((shop) => ({
      shop,
      km: here && shop.location ? distanceKm(here, shop.location) : null,
    }));
    if (!here) return withDistance;
    return withDistance.sort(
      (a, b) =>
        Number(b.shop.acceptingOrders) - Number(a.shop.acceptingOrders) ||
        (a.km ?? Infinity) - (b.km ?? Infinity),
    );
  }, [shops, here]);

  return (
    <>
      <LocationBar state={state} onLocate={locate} />
      <Group
        title={here ? 'Print shops near you' : 'Print shops'}
        footer="Prices are per printed side. The shop prints after you pay at the counter."
      >
        {rows.length === 0 && (
          <div className="px-4 py-6 text-center text-[14px] text-text-secondary">No shops yet.</div>
        )}
        {rows.map(({ shop, km }) => (
          <ShopRow key={shop.id} shop={shop} km={km} />
        ))}
      </Group>
    </>
  );
}

function LocationBar({ state, onLocate }: { state: Locate; onLocate: () => void }) {
  if (state === 'ok') return null;
  const text = {
    idle: 'See the closest shops first.',
    locating: 'Finding shops near you…',
    denied: 'Location is off, so shops are shown A–Z. You can allow it in your browser settings.',
    unsupported: 'This browser can’t share your location, so shops are shown A–Z.',
  }[state];
  return (
    <div className="mac-card mt-6 flex items-center gap-3 px-4 py-3">
      <PinIcon />
      <p className="min-w-0 flex-1 text-[14px] text-text-secondary">{text}</p>
      {(state === 'idle' || state === 'denied') && (
        <button
          type="button"
          onClick={onLocate}
          className="shrink-0 rounded-full border border-separator px-3 py-1 text-[13px] font-semibold text-accent hover:bg-selection"
        >
          {state === 'denied' ? 'Try again' : 'Use my location'}
        </button>
      )}
      {state === 'locating' && <Spinner />}
    </div>
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
  const extras = [shop.capabilities.duplex && 'Double-sided'].filter(Boolean).join(' · ');

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
          {shop.acceptingOrders ? 'Open' : 'Closed'}
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

function PinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5 shrink-0 text-accent"
      aria-hidden
    >
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}
