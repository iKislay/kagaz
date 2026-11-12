/**
 * Typed client for the admin API (PRD §11.3). Every response is validated with the shared zod
 * schemas; the session is the httpOnly `kgz_admin` cookie (sent via credentials: 'include').
 */
import { z } from 'zod';
import {
  type AdminCreatePricingRequest,
  AdminAuditListSchema,
  AdminDeviceDetailSchema,
  AdminDeviceListSchema,
  AdminEnrollmentCodeCreatedSchema,
  AdminEnrollmentCodeListSchema,
  AdminHealthSchema,
  AdminLoginResponseSchema,
  AdminMeSchema,
  AdminOrderDetailSchema,
  AdminOrderListSchema,
  AdminOverviewSchema,
  AdminPricingListSchema,
  AdminPricingVersionSchema,
  AdminPrinterDetailSchema,
  AdminPrinterListSchema,
  type AdminPrinterUpdateRequest,
  AdminReconciliationSchema,
  AdminShopDetailSchema,
  type AdminShopCreateRequest,
  type AdminShopMemberRequest,
  type AdminShopUpdateRequest,
  AdminShopsSchema,
} from '@kagaz/shared';
import { apiFetch } from '@/lib/api';

const Ok = z.object({ ok: z.literal(true) });

/** Build a query string from defined, non-empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const adminApi = {
  login: (login: string, password: string) =>
    apiFetch('/admin/auth/login', AdminLoginResponseSchema, {
      method: 'POST',
      body: { login, password },
    }),
  logout: () => apiFetch('/admin/auth/logout', Ok, { method: 'POST' }),
  me: () => apiFetch('/admin/auth/me', AdminMeSchema),

  shops: () => apiFetch('/admin/shops', AdminShopsSchema),
  shop: (id: string) => apiFetch(`/admin/shops/${id}`, AdminShopDetailSchema),
  updateShop: (id: string, body: AdminShopUpdateRequest) =>
    apiFetch(`/admin/shops/${id}`, AdminShopDetailSchema, { method: 'PATCH', body }),
  createShop: (body: AdminShopCreateRequest) =>
    apiFetch('/admin/shops', AdminShopDetailSchema, { method: 'POST', body }),
  addMember: (id: string, body: AdminShopMemberRequest) =>
    apiFetch(`/admin/shops/${id}/members`, AdminShopDetailSchema, { method: 'POST', body }),
  removeMember: (id: string, userId: string) =>
    apiFetch(`/admin/shops/${id}/members/${userId}`, AdminShopDetailSchema, { method: 'DELETE' }),

  devices: (shopId: string) => apiFetch(`/admin/shops/${shopId}/devices`, AdminDeviceListSchema),
  revokeDevice: (shopId: string, deviceId: string) =>
    apiFetch(`/admin/shops/${shopId}/devices/${deviceId}`, AdminDeviceDetailSchema, {
      method: 'PATCH',
      body: { status: 'REVOKED' },
    }),
  enrollmentCodes: (shopId: string) =>
    apiFetch(`/admin/shops/${shopId}/enrollment-codes`, AdminEnrollmentCodeListSchema),
  createEnrollmentCode: (shopId: string) =>
    apiFetch(`/admin/shops/${shopId}/enrollment-codes`, AdminEnrollmentCodeCreatedSchema, {
      method: 'POST',
    }),

  printers: (shopId: string) => apiFetch(`/admin/shops/${shopId}/printers`, AdminPrinterListSchema),
  updatePrinter: (shopId: string, printerId: string, body: AdminPrinterUpdateRequest) =>
    apiFetch(`/admin/shops/${shopId}/printers/${printerId}`, AdminPrinterDetailSchema, {
      method: 'PATCH',
      body,
    }),

  pricing: (shopId: string) => apiFetch(`/admin/shops/${shopId}/pricing`, AdminPricingListSchema),
  createPricing: (shopId: string, body: AdminCreatePricingRequest) =>
    apiFetch(`/admin/shops/${shopId}/pricing`, AdminPricingVersionSchema, { method: 'POST', body }),

  orders: (q: { q?: string; shopId?: string; status?: string; page?: number }) =>
    apiFetch(`/admin/orders${qs({ ...q, pageSize: 25 })}`, AdminOrderListSchema),
  order: (id: string) => apiFetch(`/admin/orders/${id}`, AdminOrderDetailSchema),

  audit: (q: Record<string, string | number | undefined>) =>
    apiFetch(`/admin/audit${qs({ ...q, pageSize: 50 })}`, AdminAuditListSchema),
  health: () => apiFetch('/admin/health', AdminHealthSchema),
  reconciliation: (q: { from?: string; to?: string; shopId?: string; stuckHours?: number }) =>
    apiFetch(`/admin/reconciliation${qs(q)}`, AdminReconciliationSchema),
  overview: (q: { days?: number; shopId?: string }) =>
    apiFetch(`/admin/overview${qs(q)}`, AdminOverviewSchema),
};
