import { afterAll, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../src/common/config/config.module.js';
import { type AppConfig } from '../../src/common/config/config.schema.js';
import { randomCode } from '../../src/common/crypto/tokens.js';
import { SuperAdminService } from '../../src/modules/admin/auth/super-admin.service.js';
import { type Harness, createHarness, createShop, createStaff } from './harness.js';

/** The Kagaz superadmin comes from SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD in the env. */
const email = `superadmin-${randomCode(6).toLowerCase()}@e2e.kagaz.local`;
const harnesses: Harness[] = [];

async function boot(password: string): Promise<Harness> {
  process.env.SUPERADMIN_EMAIL = email.toUpperCase(); // stored lowercased
  process.env.SUPERADMIN_PASSWORD = password;
  const h = await createHarness();
  harnesses.push(h);
  await h.app.get(SuperAdminService).ensureSynced(); // what onApplicationBootstrap kicked off
  return h;
}

function login(h: Harness, password: string) {
  return h.http().post('/api/admin/auth/login').send({ login: email, password });
}

function cookieOf(res: { headers: Record<string, unknown> }): Record<string, string> {
  const raw = res.headers['set-cookie'] as string[] | string;
  const cookie = (Array.isArray(raw) ? raw : [raw]).find((c) => c.startsWith('kgz_admin='))!;
  return { Cookie: cookie.split(';')[0]! };
}

afterAll(async () => {
  delete process.env.SUPERADMIN_EMAIL;
  delete process.env.SUPERADMIN_PASSWORD;
  for (const h of harnesses) await h.close();
});

describe('superadmin from env', () => {
  it('is created as an ADMIN at startup and can use /sudoadmin, but not be removed or reset', async () => {
    const h = await boot('First-Superadmin-Pass');
    const user = await h.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.kind).toBe('ADMIN');
    expect(user.passwordHash).not.toContain('First-Superadmin-Pass');

    const res = await login(h, 'First-Superadmin-Pass').expect(200);
    expect(res.body.admin).toMatchObject({ email, role: 'ADMIN' });
    const sa = cookieOf(res);
    const list = await h.http().get('/api/sudo/admins').set(sa).expect(200);
    expect(list.body.admins.find((a: { email: string }) => a.email === email)).toMatchObject({
      managedByEnv: true,
      isSelf: true,
    });

    // Another admin can't remove it or reset its password: the env is the source of truth.
    const other = await h
      .http()
      .post('/api/sudo/admins')
      .set(sa)
      .send({ name: 'Other', email: `other-${randomCode(6).toLowerCase()}@e2e.kagaz.local` })
      .expect(201);
    const otherCookie = cookieOf(
      await h
        .http()
        .post('/api/admin/auth/login')
        .send({ login: other.body.admin.email, password: other.body.temporaryPassword })
        .expect(200),
    );
    const removed = await h
      .http()
      .delete(`/api/sudo/admins/${user.id}`)
      .set(otherCookie)
      .expect(409);
    expect(removed.body.error.code).toBe('SUPERADMIN_MANAGED');
    const reset = await h
      .http()
      .post(`/api/sudo/admins/${user.id}/reset-password`)
      .set(otherCookie)
      .send({})
      .expect(409);
    expect(reset.body.error.code).toBe('SUPERADMIN_MANAGED');

    const audit = await h.prisma.auditLog.findFirstOrThrow({
      where: { action: 'superadmin.created', metadata: { path: ['userId'], equals: user.id } },
    });
    expect(JSON.stringify(audit)).not.toContain('First-Superadmin-Pass');
  });

  it('changing the password in env rotates it on the next start', async () => {
    const h = await boot('Second-Superadmin-Pass');
    await login(h, 'First-Superadmin-Pass').expect(401);
    await login(h, 'Second-Superadmin-Pass').expect(200);
    expect(await h.prisma.user.count({ where: { email } })).toBe(1);
  });

  it('never promotes an existing shop account to platform admin', async () => {
    const h = harnesses[0]!;
    const shop = await createShop(h.prisma);
    const owner = await createStaff(h.prisma, shop.id, 'OWNER');
    const config: AppConfig = h.app.get(APP_CONFIG);
    const svc = new SuperAdminService(
      { ...config, SUPERADMIN_EMAIL: owner.email, SUPERADMIN_PASSWORD: 'Owner-Takeover-Pass' },
      h.prisma,
    );
    expect(await svc.ensureSynced()).toBeNull();
    const user = await h.prisma.user.findUniqueOrThrow({ where: { email: owner.email } });
    expect(user.kind).toBe('STAFF');
  });
});
