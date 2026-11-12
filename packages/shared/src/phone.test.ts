import { describe, expect, it } from 'vitest';
import { AdminShopMemberRequestSchema, formatIndianPhone, normalizePhone } from './admin-api.js';

describe('formatIndianPhone', () => {
  it('shows Indian mobiles as "XXXXX XXXXX" and leaves anything else alone', () => {
    expect(formatIndianPhone('+918987263735')).toBe('89872 63735');
    expect(formatIndianPhone('+919876543210')).toBe('98765 43210');
    expect(formatIndianPhone('+14155550123')).toBe('+14155550123');
    expect(formatIndianPhone('+9198765')).toBe('+9198765');
  });
});

describe('normalizePhone', () => {
  it('turns typed Indian mobile numbers into E.164', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('098765-43210')).toBe('+919876543210');
    expect(normalizePhone('919876543210')).toBe('+919876543210');
    expect(normalizePhone(' +91 98765 43210 ')).toBe('+919876543210');
  });

  it('member requests reject anything that is not a phone number', () => {
    const base = { name: 'Raju', role: 'SHOP_OPERATOR', password: 'secret-123' };
    expect(AdminShopMemberRequestSchema.safeParse({ ...base, phone: 'raju@x.in' }).success).toBe(
      false,
    );
    expect(AdminShopMemberRequestSchema.safeParse({ ...base, phone: '12345' }).success).toBe(false);
    expect(AdminShopMemberRequestSchema.parse({ ...base, phone: '9876543210' }).phone).toBe(
      '+919876543210',
    );
  });
});
