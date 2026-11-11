import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Database-level tenant guard (CLAUDE.md invariant 10, P4.1).
 *
 * Every HTTP request runs inside a tenant scope (TenantScopeMiddleware). Once DeviceAuthGuard has
 * authenticated a shop device it records the device's shopId here; from then on every Prisma query
 * on a shop-owned model in that request must be filtered by exactly that shopId (writes must set
 * it). A query that is unscoped or names another shop throws TenantScopeViolation instead of
 * running — a 500 is a bug report, a cross-tenant read would be a data leak.
 *
 * This is a backstop for the central helpers in modules/shop/shop-scope.ts, not a replacement:
 * code still scopes its own queries. Raw SQL ($queryRaw/$executeRaw) is not inspected.
 */

interface TenantStore {
  shopId?: string;
}

const storage = new AsyncLocalStorage<TenantStore>();

/** Run `fn` (e.g. the rest of an HTTP request) in a fresh, unscoped tenant scope. */
export function runInTenantScope<T>(fn: () => T): T {
  return storage.run({}, fn);
}

/** Bind the current scope to an authenticated shop. No-op outside a scope (e.g. sockets, jobs). */
export function bindTenantShop(shopId: string): void {
  const store = storage.getStore();
  if (!store) return;
  if (store.shopId && store.shopId !== shopId) {
    throw new TenantScopeViolation(`scope already bound to another shop`);
  }
  store.shopId = shopId;
}

/** The shopId the current request is bound to, if any. */
export function currentTenantShop(): string | undefined {
  return storage.getStore()?.shopId;
}

/**
 * Where-fragment for code shared by customer, system and shop paths (e.g. the order state
 * machine): `{ shopId }` when the request is bound to a shop device, otherwise `{}`. In a device
 * request another shop's row then simply isn't found. Shop-only code passes device.shopId itself.
 */
export function tenantWhere(): { shopId?: string } {
  const shopId = currentTenantShop();
  return shopId ? { shopId } : {};
}

/** tenantWhere() for print jobs, which belong to a shop through their order. */
export function tenantJobWhere(): { order?: { shopId: string } } {
  const shopId = currentTenantShop();
  return shopId ? { order: { shopId } } : {};
}

export class TenantScopeViolation extends Error {
  constructor(detail: string) {
    super(`Tenant scope violation: ${detail}`);
    this.name = 'TenantScopeViolation';
  }
}

/** Models that carry their own shop_id column. */
const DIRECT_MODELS = new Set([
  'Order',
  'Printer',
  'ShopDevice',
  'ShopUser',
  'ShopPricing',
  'EnrollmentCode',
  'PickupCounter',
  'PrinterUptimeDaily',
  'OperatorSession',
]);

/** Models owned through a relation to a shop-owned model (relation field names). */
const VIA_RELATION: Record<string, readonly string[]> = {
  PrintJob: ['order', 'printer'],
};

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 'match' = filtered by this shop, 'other' = names a different shop, 'none' = no shop filter. */
type Scope = 'match' | 'other' | 'none';

function shopValue(v: unknown, shopId: string): Scope {
  if (typeof v === 'string') return v === shopId ? 'match' : 'other';
  if (isObj(v) && 'equals' in v) return shopValue(v.equals, shopId);
  // `in`, `not`, … are not a single-tenant filter.
  return v === undefined ? 'none' : 'other';
}

function combine(a: Scope, b: Scope): Scope {
  if (a === 'other' || b === 'other') return 'other';
  return a === 'match' || b === 'match' ? 'match' : 'none';
}

/** Does this where-clause (for a model with a direct shopId) pin it to `shopId`? */
function directWhere(where: unknown, shopId: string): Scope {
  if (!isObj(where)) return 'none';
  let scope = shopValue(where.shopId, shopId);
  for (const [key, value] of Object.entries(where)) {
    // Compound unique inputs, e.g. shopId_businessDate: { shopId, businessDate }.
    if (key.startsWith('shopId_') && isObj(value))
      scope = combine(scope, shopValue(value.shopId, shopId));
  }
  const and = where.AND;
  for (const part of Array.isArray(and) ? and : and === undefined ? [] : [and]) {
    scope = combine(scope, directWhere(part, shopId));
  }
  return scope;
}

function modelWhere(model: string, where: unknown, shopId: string): Scope {
  if (DIRECT_MODELS.has(model)) return directWhere(where, shopId);
  if (!isObj(where)) return 'none';
  let scope: Scope = 'none';
  for (const rel of VIA_RELATION[model] ?? []) {
    const relWhere = where[rel];
    // to-one relation filters may be wrapped in `is`.
    scope = combine(
      scope,
      directWhere(isObj(relWhere) && 'is' in relWhere ? relWhere.is : relWhere, shopId),
    );
  }
  const and = where.AND;
  for (const part of Array.isArray(and) ? and : and === undefined ? [] : [and]) {
    scope = combine(scope, modelWhere(model, part, shopId));
  }
  return scope;
}

function dataScope(data: unknown, shopId: string): Scope {
  if (!isObj(data)) return 'none';
  const direct = shopValue(data.shopId, shopId);
  if (direct !== 'none') return direct;
  const shop = data.shop;
  if (isObj(shop) && isObj(shop.connect)) return shopValue(shop.connect.id, shopId);
  return 'none';
}

/**
 * Throws if a query on `model` is not pinned to `shopId`. Pure — unit tested in
 * tenant-scope.test.ts; wired into Prisma by PrismaService.
 */
export function assertTenantScoped(
  model: string,
  operation: string,
  args: unknown,
  shopId: string,
): void {
  const direct = DIRECT_MODELS.has(model);
  if (!direct && !(model in VIA_RELATION)) return;
  const a: Obj = isObj(args) ? args : {};

  if (WHERE_OPS.has(operation)) {
    const scope = modelWhere(model, a.where, shopId);
    if (scope !== 'match') {
      throw new TenantScopeViolation(
        `${model}.${operation} ${scope === 'other' ? 'targets another shop' : 'is not filtered by shopId'}`,
      );
    }
  }
  // Creates: only models with their own shopId column can be checked from the payload.
  if (direct && CREATE_OPS.has(operation)) {
    const payload = operation === 'upsert' ? a.create : a.data;
    const rows = Array.isArray(payload) ? payload : [payload];
    for (const row of rows) {
      if (dataScope(row, shopId) !== 'match') {
        throw new TenantScopeViolation(`${model}.${operation} does not set this device's shopId`);
      }
    }
  }
}
