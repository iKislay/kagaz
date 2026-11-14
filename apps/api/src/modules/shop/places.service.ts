import { Injectable, Logger } from '@nestjs/common';
import { type Place } from '@kagaz/shared';

/**
 * Photon (komoot, OpenStreetMap data): free, no API key, made for type-ahead search. Nominatim's
 * usage policy forbids autocomplete, so it isn't used here.
 */
const PHOTON = 'https://photon.komoot.io';
const USER_AGENT = 'Kaggaz/1.0 (+https://kaggaz.in)';
/** Kaggaz serves Mandya: results are ranked near here until the shop has its own location. */
const MANDYA = { lat: 12.5223, lng: 76.8975 };

/** The `properties` of a Photon GeoJSON feature (only the parts we use). */
export interface PhotonProperties {
  name?: string;
  housenumber?: string;
  street?: string;
  district?: string;
  locality?: string;
  city?: string;
  county?: string;
  postcode?: string;
  countrycode?: string;
}

interface PhotonFeature {
  properties: PhotonProperties;
  geometry: { coordinates: [number, number] };
}

/**
 * One-line Indian-style address: "Name, 12 Street, Area, Town, PIN"; missing or repeated parts are
 * skipped. Reverse lookups pass `near: true` because the closest named place is a landmark next
 * to the shop, not the shop: "Near Vinayaka Nursing Home, Hospital Road, …".
 */
export function formatAddress(p: PhotonProperties, near = false): string | null {
  const parts = [
    p.name && (near ? `Near ${p.name}` : p.name),
    [p.housenumber, p.street].filter(Boolean).join(' '),
    p.locality ?? p.district,
    p.city ?? p.county,
    p.postcode,
  ].filter((v): v is string => Boolean(v));
  const unique = parts.filter((v, i) => parts.indexOf(v) === i);
  return unique.length > 0 ? unique.join(', ').slice(0, 300) : null;
}

/** Search results → places in India with a usable address. */
export function toPlaces(features: PhotonFeature[]): Place[] {
  return features.flatMap((f) => {
    const address = f.properties.countrycode === 'IN' ? formatAddress(f.properties) : null;
    if (!address) return [];
    const [lng, lat] = f.geometry.coordinates;
    return [{ name: f.properties.name ?? f.properties.street ?? address, address, lat, lng }];
  });
}

/**
 * Address search and reverse lookup for the shop's location, proxied so the app never calls a
 * third party directly. Best effort: an outage returns no suggestions, never an error page.
 */
@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);

  async search(q: string, near: { lat: number; lng: number } | null): Promise<Place[]> {
    const at = near ?? MANDYA;
    const body = await this.get('/api/', {
      q,
      limit: '8',
      lang: 'en',
      lat: String(at.lat),
      lon: String(at.lng),
    });
    return body ? toPlaces(body.features).slice(0, 5) : [];
  }

  async reverse(lat: number, lng: number): Promise<string | null> {
    const body = await this.get('/reverse', {
      lat: String(lat),
      lon: String(lng),
      lang: 'en',
      limit: '1',
    });
    const first = body?.features[0];
    return first ? formatAddress(first.properties, true) : null;
  }

  private async get(
    path: string,
    params: Record<string, string>,
  ): Promise<{ features: PhotonFeature[] } | null> {
    const url = new URL(path, PHOTON);
    url.search = new URLSearchParams(params).toString();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { features: PhotonFeature[] };
    } catch (err) {
      this.logger.warn({ err: (err as Error).message, path }, 'Place lookup failed');
      return null;
    }
  }
}
