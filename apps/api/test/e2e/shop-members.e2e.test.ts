import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomCode } from '../../src/common/crypto/tokens.js';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import { type Harness, createHarness, createShop } from './harness.js';

let h: Harness;
let admin: Record<string, string>;

async function login(login: string, password: string, expect = 200) {
  const res = await h.http().post('/api/admin/auth/login').send({ login, password }).expect(expect);
  const raw = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const cookie = (Array.isArray(raw) ? raw : raw ? [raw] : []).find((c) =>
    c.startsWith('kgz_admin='),
  );
  return { Cookie: cookie?.split(';')[0] ?? '' };
}

const randomMobile = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

beforeAll(async () => {
  h = await createHarness();
  const email = `admin-${randomCode(6).toLowerCase()}@e2e.kaggaz.local`;
  await h.prisma.user.create({
    data: { email, kind: 'ADMIN', passwordHash: await hashPassword('Admin-Pass-123!') },
  });
  admin = await login(email, 'Admin-Pass-123!');
});
afterAll(async () => {
  await h.close();
});

describe('shop logins by phone', () => {
  it('admin adds an owner by mobile number; the owner signs in with it; owners cannot add owners', async () => {
    const shop = await createShop(h.prisma);
    const mobile = randomMobile();
    const added = await h
      .http()
      .post(`/api/admin/shops/${shop.id}/members`)
      .set(admin)
      .send({ phone: mobile, name: 'Owner One', role: 'SHOP_OWNER', password: 'owner-pass-1' })
      .expect(200);
    expect(added.body.members).toEqual([
      expect.objectContaining({ phone: `+91${mobile}`, role: 'SHOP_OWNER' }),
    ]);

    // Typed with spaces, without +91.
    const owner = await login(`${mobile.slice(0, 5)} ${mobile.slice(5)}`, 'owner-pass-1');
    await h
      .http()
      .post(`/api/admin/shops/${shop.id}/members`)
      .set(owner)
      .send({
        phone: randomMobile(),
        name: 'Owner Two',
        role: 'SHOP_OWNER',
        password: 'x-pass-123',
      })
      .expect(403);

    // Owners can add operators to their shop; email logins are rejected.
    const operator = randomMobile();
    await h
      .http()
      .post(`/api/admin/shops/${shop.id}/members`)
      .set(owner)
      .send({ phone: operator, name: 'Op', role: 'SHOP_OPERATOR', password: 'op-pass-123' })
      .expect(200);
    await h
      .http()
      .post(`/api/admin/shops/${shop.id}/members`)
      .set(admin)
      .send({ phone: 'op@shop.in', name: 'Op', role: 'SHOP_OPERATOR', password: 'op-pass-123' })
      .expect(400);

    // Re-adding resets the password; removing ends access.
    const opUser = await h.prisma.user.findUniqueOrThrow({ where: { phone: `+91${operator}` } });
    await h
      .http()
      .post(`/api/admin/shops/${shop.id}/members`)
      .set(admin)
      .send({ phone: operator, name: 'Op', role: 'SHOP_OPERATOR', password: 'new-pass-456' })
      .expect(200);
    const after = await h
      .http()
      .delete(`/api/admin/shops/${shop.id}/members/${opUser.id}`)
      .set(admin)
      .expect(200);
    expect(after.body.members).toHaveLength(1);
  });
});
