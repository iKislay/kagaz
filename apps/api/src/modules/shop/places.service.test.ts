import { describe, expect, it } from 'vitest';
import { formatAddress, toPlaces } from './places.service.js';

describe('formatAddress', () => {
  it('builds name, street, area, town and PIN', () => {
    expect(
      formatAddress({
        name: 'KSRTC Bus Stand',
        housenumber: '12',
        street: 'Dr. Rajkumar Road',
        locality: 'Ashok Nagar',
        city: 'Mandya',
        postcode: '571401',
      }),
    ).toBe('KSRTC Bus Stand, 12 Dr. Rajkumar Road, Ashok Nagar, Mandya, 571401');
  });

  it('marks the landmark of a reverse lookup as "Near"', () => {
    expect(
      formatAddress(
        { name: 'Vinayaka Nursing Home', street: 'Hospital Road', city: 'Mandya' },
        true,
      ),
    ).toBe('Near Vinayaka Nursing Home, Hospital Road, Mandya');
  });

  it('skips missing and repeated parts; null when nothing is usable', () => {
    expect(
      formatAddress({ street: 'VV Nagar', locality: 'VV Nagar', county: 'Mandya taluk' }),
    ).toBe('VV Nagar, Mandya taluk');
    expect(formatAddress({})).toBeNull();
  });
});

describe('toPlaces', () => {
  it('keeps places in India, with lat/lng from GeoJSON [lng, lat]', () => {
    expect(
      toPlaces([
        {
          properties: { name: 'Bus Stand', city: 'Mandya', countrycode: 'IN' },
          geometry: { coordinates: [76.89, 12.52] },
        },
        {
          properties: { name: 'Mandya Street', city: 'Elsewhere', countrycode: 'US' },
          geometry: { coordinates: [-70, 40] },
        },
      ]),
    ).toEqual([{ name: 'Bus Stand', address: 'Bus Stand, Mandya', lat: 12.52, lng: 76.89 }]);
  });
});
