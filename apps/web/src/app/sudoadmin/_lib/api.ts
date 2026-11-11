/**
 * Typed client for the platform-owner API (`/api/sudo/*`). Responses are validated with the
 * shared zod schemas; the session is the same httpOnly `kgz_admin` cookie as /admin.
 */
import { z } from 'zod';
import {
  type ShopMemberRole,
  type SudoAdminCreateRequest,
  SudoAdminCreatedSchema,
  SudoAdminListSchema,
  type SudoMemberCreateRequest,
  SudoMemberCreatedSchema,
  SudoMemberSchema,
  SudoOverviewSchema,
  SudoPasswordResetSchema,
  type SudoPlanCreateRequest,
  SudoPlanListSchema,
  SudoPlanSchema,
  type SudoPlanUpdateRequest,
  type SudoShopCreateRequest,
  SudoShopCreatedSchema,
  SudoShopDetailSchema,
  SudoShopListSchema,
  type SudoSubscriptionCancelRequest,
  type SudoSubscriptionCreateRequest,
  type SudoSubscriptionPaymentCreateRequest,
  SudoSubscriptionPaymentSchema,
  SudoSubscriptionSchema,
  type SudoSubscriptionUpdateRequest,
} from '@kagaz/shared';
import { apiFetch } from '@/lib/api';

const Ok = z.object({ ok: z.literal(true) });
const shop = (id: string) => `/sudo/shops/${id}`;

export const sudoApi = {
  overview: () => apiFetch('/sudo/overview', SudoOverviewSchema),

  shops: () => apiFetch('/sudo/shops', SudoShopListSchema),
  shop: (id: string) => apiFetch(shop(id), SudoShopDetailSchema),
  onboard: (body: SudoShopCreateRequest) =>
    apiFetch('/sudo/shops', SudoShopCreatedSchema, { method: 'POST', body }),
  suspend: (id: string, reason: string) =>
    apiFetch(`${shop(id)}/suspend`, SudoShopDetailSchema, { method: 'POST', body: { reason } }),
  reactivate: (id: string) =>
    apiFetch(`${shop(id)}/reactivate`, SudoShopDetailSchema, { method: 'POST' }),
  archive: (id: string, reason: string) =>
    apiFetch(`${shop(id)}/archive`, SudoShopDetailSchema, { method: 'POST', body: { reason } }),
  restore: (id: string) =>
    apiFetch(`${shop(id)}/restore`, SudoShopDetailSchema, { method: 'POST' }),
  deleteShop: (id: string, confirmSlug: string) =>
    apiFetch(shop(id), Ok, { method: 'DELETE', body: { confirmSlug } }),

  addMember: (id: string, body: SudoMemberCreateRequest) =>
    apiFetch(`${shop(id)}/members`, SudoMemberCreatedSchema, { method: 'POST', body }),
  setMemberRole: (id: string, userId: string, role: ShopMemberRole) =>
    apiFetch(`${shop(id)}/members/${userId}`, SudoMemberSchema, {
      method: 'PATCH',
      body: { role },
    }),
  resetMemberPassword: (id: string, userId: string, password?: string) =>
    apiFetch(`${shop(id)}/members/${userId}/reset-password`, SudoPasswordResetSchema, {
      method: 'POST',
      body: password ? { password } : {},
    }),
  removeMember: (id: string, userId: string) =>
    apiFetch(`${shop(id)}/members/${userId}`, Ok, { method: 'DELETE' }),

  createSubscription: (id: string, body: SudoSubscriptionCreateRequest) =>
    apiFetch(`${shop(id)}/subscriptions`, SudoSubscriptionSchema, { method: 'POST', body }),
  updateSubscription: (id: string, subId: string, body: SudoSubscriptionUpdateRequest) =>
    apiFetch(`${shop(id)}/subscriptions/${subId}`, SudoSubscriptionSchema, {
      method: 'PATCH',
      body,
    }),
  cancelSubscription: (id: string, subId: string, body: SudoSubscriptionCancelRequest) =>
    apiFetch(`${shop(id)}/subscriptions/${subId}/cancel`, SudoSubscriptionSchema, {
      method: 'POST',
      body,
    }),
  deleteSubscription: (id: string, subId: string) =>
    apiFetch(`${shop(id)}/subscriptions/${subId}`, Ok, { method: 'DELETE' }),
  recordPayment: (id: string, subId: string, body: SudoSubscriptionPaymentCreateRequest) =>
    apiFetch(`${shop(id)}/subscriptions/${subId}/payments`, SudoSubscriptionPaymentSchema, {
      method: 'POST',
      body,
    }),
  deletePayment: (id: string, paymentId: string) =>
    apiFetch(`${shop(id)}/payments/${paymentId}`, Ok, { method: 'DELETE' }),

  plans: () => apiFetch('/sudo/plans', SudoPlanListSchema),
  createPlan: (body: SudoPlanCreateRequest) =>
    apiFetch('/sudo/plans', SudoPlanSchema, { method: 'POST', body }),
  updatePlan: (planId: string, body: SudoPlanUpdateRequest) =>
    apiFetch(`/sudo/plans/${planId}`, SudoPlanSchema, { method: 'PATCH', body }),
  deletePlan: (planId: string) => apiFetch(`/sudo/plans/${planId}`, Ok, { method: 'DELETE' }),

  admins: () => apiFetch('/sudo/admins', SudoAdminListSchema),
  createAdmin: (body: SudoAdminCreateRequest) =>
    apiFetch('/sudo/admins', SudoAdminCreatedSchema, { method: 'POST', body }),
  resetAdminPassword: (userId: string, password?: string) =>
    apiFetch(`/sudo/admins/${userId}/reset-password`, SudoPasswordResetSchema, {
      method: 'POST',
      body: password ? { password } : {},
    }),
  removeAdmin: (userId: string) => apiFetch(`/sudo/admins/${userId}`, Ok, { method: 'DELETE' }),
};
