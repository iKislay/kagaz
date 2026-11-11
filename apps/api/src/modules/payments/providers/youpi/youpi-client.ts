/**
 * Minimal typed HTTP client for a self-hosted YouPI payment-api (ADR-003).
 * Server-to-server only. Never logs keys, tokens or full URLs with secrets.
 *
 * Endpoints used (YouPI-PG apps/payment-api):
 *   POST /api/v1/payments                         merchant key  — create a checkout session
 *   GET  /api/v1/payments/:id                     merchant key  — session status (owner view)
 *   POST /api/v1/admin/merchants                  admin token   — onboard a shop
 *   POST /api/v1/admin/upi-accounts               admin token   — add a VPA to a merchant
 *   POST /api/v1/admin/upi-accounts/:id/activate  admin token   — make it the active VPA
 *   GET  /api/v1/admin/upi-accounts?merchantId=   admin token
 *   GET  /api/v1/admin/sms-gateway/pair-qr        admin token   — Android observer pairing
 *   GET  /api/v1/admin/sms-gateway/devices        admin token   — paired phones + heartbeat
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface YoupiClientOptions {
  baseUrl: string;
  adminToken: string;
  timeoutMs: number;
  fetch?: FetchLike;
}

/** Network failure, timeout or a non-2xx answer from YouPI. */
export class YoupiError extends Error {
  override name = 'YoupiError';
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
  }
}

export interface YoupiMerchantCredentials {
  merchantId: string;
  apiKey: string;
}

export interface YoupiCreatedPayment {
  paymentId: string;
  checkoutUrl: string;
  status: string;
}

export interface YoupiPaymentView {
  paymentId: string;
  orderId: string;
  amountPaise: number | null;
  currency: string;
  /** Public outcome when terminal, internal status otherwise (QUEUED, ACTIVE, PROCESSING …). */
  status: string;
  settlementState: string | null;
  method: string;
  completedAt: string | null;
}

export interface YoupiDevice {
  id: string;
  name: string;
  isActive: boolean;
  lastHeartbeatAt: string | null;
  lastObservationAt: string | null;
}

export interface YoupiUpiAccount {
  id: string;
  upiId: string;
  payeeName: string;
  isActive: boolean;
}

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Integer paise from a number or a digit string; null otherwise. */
export function parsePaise(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : null;
  if (typeof v === 'string' && /^\d{1,15}$/.test(v)) return Number(v);
  return null;
}

/** 4800 → "48.00" — exact, no floats. */
export function paiseToRupeeString(paise: number): string {
  const rupees = Math.floor(paise / 100);
  return `${rupees}.${String(paise % 100).padStart(2, '0')}`;
}

export class YoupiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: YoupiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  // ─── Merchant-key calls ───

  async createPayment(
    creds: YoupiMerchantCredentials,
    input: {
      orderId: string;
      amountPaise: number;
      returnUrl: string;
      idempotencyKey: string;
      metadata: Record<string, string>;
    },
  ): Promise<YoupiCreatedPayment> {
    const body = await this.request('POST', '/api/v1/payments', {
      headers: {
        'X-Merchant-Id': creds.merchantId,
        'X-Merchant-Key': creds.apiKey,
        'Idempotency-Key': input.idempotencyKey,
      },
      json: {
        orderId: input.orderId,
        amount: paiseToRupeeString(input.amountPaise),
        currency: 'INR',
        method: 'UPI',
        returnUrl: input.returnUrl,
        metadata: input.metadata,
      },
    });
    const paymentId = str(body.paymentId);
    const checkoutUrl = str(body.checkoutUrl);
    if (!paymentId || !checkoutUrl) {
      throw new YoupiError(
        'YouPI create payment: missing paymentId/checkoutUrl',
        200,
        'BAD_RESPONSE',
      );
    }
    const amount = parsePaise(body.amountPaise);
    if (amount !== null && amount !== input.amountPaise) {
      // YouPI already had this orderId with another amount — never accept that session.
      throw new YoupiError('YouPI create payment: amount mismatch', 200, 'AMOUNT_MISMATCH');
    }
    return { paymentId, checkoutUrl, status: str(body.status) ?? 'UNKNOWN' };
  }

  async getPayment(creds: YoupiMerchantCredentials, paymentId: string): Promise<YoupiPaymentView> {
    const body = await this.request('GET', `/api/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { 'X-Merchant-Key': creds.apiKey },
    });
    return {
      paymentId: str(body.paymentId) ?? paymentId,
      orderId: str(body.orderId) ?? '',
      amountPaise: parsePaise(body.amountPaise),
      currency: str(body.currency) ?? 'INR',
      status: str(body.internalStatus) ?? str(body.status) ?? 'UNKNOWN',
      settlementState: str(body.settlementState),
      method: str(body.method) ?? 'UPI',
      completedAt: str(body.completedAt),
    };
  }

  // ─── Admin calls (provisioning) ───

  async createMerchant(input: {
    businessName: string;
    slug: string;
    webhookUrl: string;
    upiId: string;
    apiKey: string;
    webhookSecret: string;
  }): Promise<{ merchantId: string }> {
    const body = await this.request('POST', '/api/v1/admin/merchants', {
      admin: true,
      json: input,
    });
    const merchant = (body.merchant ?? {}) as Json;
    const merchantId = str(merchant.id);
    if (!merchantId) throw new YoupiError('YouPI create merchant: no id', 200, 'BAD_RESPONSE');
    return { merchantId };
  }

  async listUpiAccounts(merchantId: string): Promise<YoupiUpiAccount[]> {
    const body = await this.request(
      'GET',
      `/api/v1/admin/upi-accounts?merchantId=${encodeURIComponent(merchantId)}`,
      { admin: true },
    );
    const list = Array.isArray(body.accounts) ? (body.accounts as Json[]) : [];
    // YouPI falls back to its DEFAULT merchant for an unknown id: never trust such rows.
    if (list.some((a) => a.merchantId !== merchantId)) {
      throw new YoupiError('YouPI returned accounts of another merchant', 200, 'MERCHANT_MISMATCH');
    }
    return list.map((a) => ({
      id: str(a.id) ?? '',
      upiId: str(a.upiId) ?? '',
      payeeName: str(a.payeeName) ?? '',
      isActive: Boolean(a.isActive),
    }));
  }

  async addUpiAccount(
    merchantId: string,
    upiId: string,
    payeeName: string,
  ): Promise<YoupiUpiAccount> {
    const body = await this.request('POST', '/api/v1/admin/upi-accounts', {
      admin: true,
      json: { merchantId, upiId, payeeName, isActive: false },
    });
    const a = (body.account ?? {}) as Json;
    const id = str(a.id);
    if (!id) throw new YoupiError('YouPI add UPI account: no id', 200, 'BAD_RESPONSE');
    if (a.merchantId !== merchantId) {
      throw new YoupiError('YouPI added the UPI ID to another merchant', 200, 'MERCHANT_MISMATCH');
    }
    return { id, upiId, payeeName, isActive: Boolean(a.isActive) };
  }

  async activateUpiAccount(accountId: string): Promise<void> {
    await this.request(
      'POST',
      `/api/v1/admin/upi-accounts/${encodeURIComponent(accountId)}/activate`,
      {
        admin: true,
        json: {},
      },
    );
  }

  async pairingPayload(merchantId: string): Promise<{ qrText: string; expiresAt: Date }> {
    const body = await this.request(
      'GET',
      `/api/v1/admin/sms-gateway/pair-qr?merchantId=${encodeURIComponent(merchantId)}`,
      { admin: true },
    );
    const payload = (body.payload ?? {}) as Json;
    if (payload.merchantId !== merchantId) {
      throw new YoupiError('YouPI pairing code is for another merchant', 200, 'MERCHANT_MISMATCH');
    }
    const qrText = str(body.pairingPayload);
    const expires = typeof body.expiresAt === 'number' ? body.expiresAt : Date.now() + 600_000;
    if (!qrText) throw new YoupiError('YouPI pairing: no payload', 200, 'BAD_RESPONSE');
    return { qrText, expiresAt: new Date(expires) };
  }

  async devices(merchantId: string): Promise<YoupiDevice[]> {
    const body = await this.request(
      'GET',
      `/api/v1/admin/sms-gateway/devices?merchantId=${encodeURIComponent(merchantId)}`,
      { admin: true },
    );
    const list = Array.isArray(body.devices) ? (body.devices as Json[]) : [];
    return list.map((d) => ({
      id: str(d.id) ?? '',
      name: str(d.deviceName) ?? 'Android phone',
      isActive: Boolean(d.isActive),
      lastHeartbeatAt: str(d.lastHeartbeatAt),
      lastObservationAt: str(d.lastObservationAt),
    }));
  }

  /** Public URL that serves the observer APK (YouPI `GET /youpi-sms-gateway.apk`). */
  static apkUrl(publicBaseUrl: string): string {
    return `${publicBaseUrl.replace(/\/+$/, '')}/youpi-sms-gateway.apk`;
  }

  // ─── Transport ───

  private async request(
    method: 'GET' | 'POST',
    path: string,
    opts: { headers?: Record<string, string>; json?: unknown; admin?: boolean },
  ): Promise<Json> {
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    if (opts.admin) headers.Authorization = `Bearer ${this.options.adminToken}`;
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.json === undefined ? undefined : JSON.stringify(opts.json),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (err) {
      const timeout = err instanceof Error && err.name === 'TimeoutError';
      throw new YoupiError(
        `YouPI ${method} ${pathOnly(path)} ${timeout ? 'timed out' : 'unreachable'}`,
        null,
        timeout ? 'TIMEOUT' : 'UNREACHABLE',
      );
    }
    let body: Json = {};
    try {
      const parsed: unknown = await res.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Json;
    } catch {
      // Non-JSON body: keep {}.
    }
    if (!res.ok) {
      throw new YoupiError(
        `YouPI ${method} ${pathOnly(path)} → ${res.status}`,
        res.status,
        str(body.code) ?? str(body.error),
      );
    }
    return body;
  }
}

/** Strip the query string (ids only; never secrets, but keep logs short). */
const pathOnly = (path: string) => path.split('?')[0];
