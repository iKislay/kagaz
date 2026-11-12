/** A map position (WGS84 degrees). */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle (haversine) distance in kilometres — good enough for "shops near you". */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "350 m" under 1 km, "1.4 km" under 10 km, then "12 km". */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** Website path a shop's QR code points to (`/s/<slug>`); it opens a new order at that shop. */
export const shopOrderPath = (slug: string) => `/s/${encodeURIComponent(slug)}`;

/**
 * The shop slug in a scanned Kagaz shop link, or null. Accepts `…/s/<slug>` and
 * `…/order/new?shop=<slug-or-id>` on any host (the QR carries the public web URL), so the
 * scanner only ever navigates inside this site — never to a foreign URL.
 */
export function shopFromScannedText(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const short = /^\/s\/([a-z0-9][a-z0-9-]{0,62})\/?$/i.exec(url.pathname);
  if (short) return short[1]!.toLowerCase();
  if (url.pathname.replace(/\/$/, '') === '/order/new') {
    const shop = url.searchParams.get('shop');
    if (shop && /^[a-z0-9-]{1,64}$/i.test(shop)) return shop;
  }
  return null;
}
