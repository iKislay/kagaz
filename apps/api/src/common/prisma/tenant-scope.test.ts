import { describe, expect, it } from 'vitest';
import {
  TenantScopeViolation,
  assertTenantScoped,
  bindTenantShop,
  currentTenantShop,
  runInTenantScope,
} from './tenant-scope.js';

const A = '00000000-0000-7000-8000-00000000000a';
const B = '00000000-0000-7000-8000-00000000000b';
const ok = (model: string, op: string, args: unknown) => () =>
  assertTenantScoped(model, op, args, A);

describe('assertTenantScoped (P4.1)', () => {
  it('allows reads filtered by the bound shop', () => {
    expect(ok('Order', 'findFirst', { where: { id: 'x', shopId: A } })).not.toThrow();
    expect(
      ok('Order', 'findMany', { where: { AND: [{ status: 'QUEUED' }, { shopId: A }] } }),
    ).not.toThrow();
    expect(ok('Order', 'count', { where: { shopId: { equals: A } } })).not.toThrow();
    expect(
      ok('PickupCounter', 'findUnique', {
        where: { shopId_businessDate: { shopId: A, businessDate: 'd' } },
      }),
    ).not.toThrow();
  });

  it('rejects unscoped reads and updates of shop-owned models', () => {
    expect(ok('Order', 'findUnique', { where: { id: 'x' } })).toThrow(TenantScopeViolation);
    expect(ok('Printer', 'findMany', {})).toThrow(/not filtered by shopId/);
    expect(ok('ShopDevice', 'update', { where: { id: 'd' }, data: {} })).toThrow(
      TenantScopeViolation,
    );
    expect(ok('Order', 'findMany', { where: { shopId: { in: [A, B] } } })).toThrow(
      TenantScopeViolation,
    );
  });

  it('rejects queries that name another shop, even next to this one', () => {
    expect(ok('Order', 'findFirst', { where: { id: 'x', shopId: B } })).toThrow(/another shop/);
    expect(ok('Order', 'findFirst', { where: { shopId: A, AND: [{ shopId: B }] } })).toThrow(
      /another shop/,
    );
  });

  it('scopes print jobs through their order or printer', () => {
    expect(ok('PrintJob', 'findFirst', { where: { id: 'j', order: { shopId: A } } })).not.toThrow();
    expect(ok('PrintJob', 'findMany', { where: { printer: { is: { shopId: A } } } })).not.toThrow();
    expect(ok('PrintJob', 'findUnique', { where: { id: 'j' } })).toThrow(TenantScopeViolation);
    expect(ok('PrintJob', 'findFirst', { where: { order: { shopId: B } } })).toThrow(
      /another shop/,
    );
    // Creates can't be checked from the payload (orderId only); the order was scoped first.
    expect(ok('PrintJob', 'create', { data: { orderId: 'o', attempt: 2 } })).not.toThrow();
  });

  it('requires creates and upserts to set the bound shop', () => {
    expect(ok('Printer', 'create', { data: { shopId: A, printerName: 'p' } })).not.toThrow();
    expect(
      ok('Printer', 'create', { data: { shop: { connect: { id: A } }, printerName: 'p' } }),
    ).not.toThrow();
    expect(ok('Printer', 'create', { data: { shopId: B } })).toThrow(TenantScopeViolation);
    expect(ok('Printer', 'createMany', { data: [{ shopId: A }, { shopId: B }] })).toThrow(
      TenantScopeViolation,
    );
    expect(
      ok('Printer', 'upsert', {
        where: { shopId_printerName: { shopId: A, printerName: 'p' } },
        create: { shopId: A },
      }),
    ).not.toThrow();
    expect(
      ok('Printer', 'upsert', {
        where: { shopId_printerName: { shopId: A, printerName: 'p' } },
        create: {},
      }),
    ).toThrow(TenantScopeViolation);
  });

  it('ignores models that are not shop-owned', () => {
    expect(ok('AuditLog', 'create', { data: { action: 'x' } })).not.toThrow();
    expect(ok('Payment', 'findMany', {})).not.toThrow();
  });
});

describe('tenant scope context', () => {
  it('binds per scope and never leaks between scopes', async () => {
    expect(currentTenantShop()).toBeUndefined();
    await Promise.all([
      runInTenantScope(async () => {
        bindTenantShop(A);
        await new Promise((r) => setTimeout(r, 5));
        expect(currentTenantShop()).toBe(A);
      }),
      runInTenantScope(async () => {
        bindTenantShop(B);
        await new Promise((r) => setTimeout(r, 1));
        expect(currentTenantShop()).toBe(B);
      }),
    ]);
    expect(currentTenantShop()).toBeUndefined();
  });

  it('refuses to rebind a scope to another shop; binding outside a scope is a no-op', () => {
    runInTenantScope(() => {
      bindTenantShop(A);
      bindTenantShop(A);
      expect(() => bindTenantShop(B)).toThrow(TenantScopeViolation);
    });
    bindTenantShop(A);
    expect(currentTenantShop()).toBeUndefined();
  });
});
