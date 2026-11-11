'use client';

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import {
  type CustomerSocketAuth,
  type PublicOrder,
  REALTIME_PATH,
  RealtimeEvent,
  RealtimeNamespace,
} from '@kagaz/shared';
import { API_URL, ApiRequestError, getOrder } from '@/lib/api';
import { TERMINAL } from '@/lib/status';
import { loadTrackingToken } from '@/lib/tracking';

/** Safety poll: the socket is only a hint, REST is the truth (invariant 13). */
const SAFETY_POLL_MS = 30_000;
const RETRY_MS = 10_000;

export interface OrderUpdates {
  order: PublicOrder | null;
  token: string | null;
  error: { notFound: boolean; message: string } | null;
}

/**
 * Live order state for the tracking page (P2.9): fetch over REST, re-fetch whenever the
 * `/customer` socket hints `order.updated` (or reconnects), plus a 30 s safety poll in case
 * hints are lost or websockets are blocked. Stops once the order is final.
 */
export function useOrderUpdates(
  orderId: string,
): OrderUpdates & { setOrder: (order: PublicOrder) => void } {
  const [state, setState] = useState<OrderUpdates>({ order: null, token: null, error: null });

  useEffect(() => {
    const token = loadTrackingToken(orderId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let inFlight = false;
    let again = false;

    const socket = io(`${new URL(API_URL).origin}${RealtimeNamespace.CUSTOMER}`, {
      path: REALTIME_PATH,
      withCredentials: true, // the API's per-order tracking cookie also authenticates
      auth: { orderId, ...(token ? { trackingToken: token } : {}) } satisfies CustomerSocketAuth,
      reconnectionDelayMax: 30_000,
    });

    const refresh = async (): Promise<void> => {
      if (inFlight) {
        again = true; // a hint arrived mid-request: fetch once more afterwards
        return;
      }
      inFlight = true;
      clearTimeout(timer);
      let delay = SAFETY_POLL_MS;
      try {
        const order = await getOrder(orderId, token);
        if (cancelled) return;
        setState({ order, token, error: null });
        if (TERMINAL.includes(order.status)) {
          socket.disconnect();
          return;
        }
      } catch (err) {
        if (cancelled) return;
        const notFound = err instanceof ApiRequestError && err.status === 404;
        setState((s) => ({
          ...s,
          token,
          error: {
            notFound,
            message: err instanceof ApiRequestError ? err.message : 'Something went wrong.',
          },
        }));
        if (notFound) {
          socket.disconnect();
          return;
        }
        delay = RETRY_MS; // keep retrying network errors
      } finally {
        inFlight = false;
      }
      if (again) {
        again = false;
        void refresh();
      } else {
        timer = setTimeout(() => void refresh(), delay);
      }
    };

    socket.on(RealtimeEvent.ORDER_UPDATED, () => void refresh());
    // After a reconnect we may have missed hints: reconcile over REST.
    socket.io.on('reconnect', () => void refresh());
    void refresh();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      socket.disconnect();
    };
  }, [orderId]);

  /** Apply an order returned by a REST command (e.g. pay retry) without waiting for a hint. */
  const setOrder = (order: PublicOrder): void => setState((s) => ({ ...s, order }));
  return { ...state, setOrder };
}
