/** Subscriptions API (ADR-004) — Kaggaz admins only. */
import {
  AdminBillingOverviewSchema,
  AdminShopBillingSchema,
  type CancelSubscriptionRequest,
  type ChangeEndDateRequest,
  type ChangePlanRequest,
  type CreateSubscriptionRequest,
  type RecordSubscriptionPaymentRequest,
} from '@kagaz/shared';
import { apiFetch } from '@/lib/api';

export const billingApi = {
  overview: () => apiFetch('/admin/billing', AdminBillingOverviewSchema),
  shop: (shopId: string) => apiFetch(`/admin/shops/${shopId}/billing`, AdminShopBillingSchema),
  create: (shopId: string, body: CreateSubscriptionRequest) =>
    apiFetch(`/admin/shops/${shopId}/subscriptions`, AdminShopBillingSchema, {
      method: 'POST',
      body,
    }),
  pay: (shopId: string, subId: string, body: RecordSubscriptionPaymentRequest) =>
    apiFetch(`/admin/shops/${shopId}/subscriptions/${subId}/payments`, AdminShopBillingSchema, {
      method: 'POST',
      body,
    }),
  changePlan: (shopId: string, subId: string, body: ChangePlanRequest) =>
    apiFetch(`/admin/shops/${shopId}/subscriptions/${subId}/change-plan`, AdminShopBillingSchema, {
      method: 'POST',
      body,
    }),
  changeEndDate: (shopId: string, subId: string, body: ChangeEndDateRequest) =>
    apiFetch(`/admin/shops/${shopId}/subscriptions/${subId}/end-date`, AdminShopBillingSchema, {
      method: 'POST',
      body,
    }),
  cancel: (shopId: string, subId: string, body: CancelSubscriptionRequest) =>
    apiFetch(`/admin/shops/${shopId}/subscriptions/${subId}/cancel`, AdminShopBillingSchema, {
      method: 'POST',
      body,
    }),
};
