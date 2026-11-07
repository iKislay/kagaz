/** Run manifest written by load-orders and read by verify-run. */
import { type OrderStatus, type PrintOptions } from '@kagaz/shared';

export interface ManifestOrder {
  orderId: string;
  publicRef: string;
  shopId: string;
  shopSlug: string;
  /** Customer bearer secret, needed to poll/collect during the run (manifest is in OS temp). */
  trackingToken: string;
  options: PrintOptions;
  pages: number;
  amountPaise: number | null;
  abandoned: boolean;
  doublePay: boolean;
  paidAt: string | null;
  readyAt: string | null;
  collectedAt: string | null;
  finalStatus: OrderStatus | null;
  error: string | null;
}

export interface Manifest {
  runId: string;
  api: string;
  startedAt: string;
  placedAt: string | null;
  finishedAt: string | null;
  requested: number;
  shops: Array<{ id: string; slug: string; name: string }>;
  orders: ManifestOrder[];
  collect: boolean;
}
