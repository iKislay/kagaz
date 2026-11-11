import { createHmac, randomUUID } from 'node:crypto';
import { type FetchLike } from './youpi-client.js';

/**
 * In-memory stand-in for the YouPI payment-api, faithful to the parts Kagaz uses (routes,
 * auth headers, status vocabulary, webhook signing). Tests only — never wired in production.
 */
export interface FakeMerchant {
  id: string;
  apiKey: string;
  webhookSecret: string;
  webhookUrl: string;
  accounts: {
    id: string;
    merchantId: string;
    upiId: string;
    payeeName: string;
    isActive: boolean;
  }[];
}

export interface FakeSession {
  id: string;
  merchantId: string;
  orderId: string;
  amountPaise: number;
  status: string;
  method: string;
  utr: string | null;
}

export class FakeYoupi {
  readonly adminToken = 'fake-admin-token-0123456789abcdef0123';
  readonly merchants = new Map<string, FakeMerchant>();
  readonly sessions = new Map<string, FakeSession>();
  readonly devices = new Map<
    string,
    { id: string; deviceName: string; isActive: boolean; lastHeartbeatAt: string | null }[]
  >();
  /** Requests seen, for assertions (path + method + headers). */
  readonly calls: { method: string; path: string; headers: Record<string, string> }[] = [];
  /** When set, every request fails like a network error. */
  down = false;

  readonly fetch: FetchLike = async (input, init) => {
    if (this.down) throw new TypeError('fetch failed');
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    this.calls.push({ method, path: url.pathname, headers });
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const [status, json] = this.route(method, url, headers, body);
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  /** Create a merchant directly (as provisioning would). */
  addMerchant(): FakeMerchant {
    const m: FakeMerchant = {
      id: randomUUID(),
      apiKey: `yp_live_${randomUUID().replace(/-/g, '')}`,
      webhookSecret: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
      webhookUrl: 'https://kagaz.test/api/webhooks/youpi',
      accounts: [],
    };
    this.merchants.set(m.id, m);
    return m;
  }

  /** Move a session to a YouPI status (OBSERVED_SUCCESS, FAILED, MANUAL_REVIEW …). */
  settle(paymentId: string, status: string, utr: string | null = null): void {
    const s = this.sessions.get(paymentId);
    if (!s) throw new Error(`no session ${paymentId}`);
    s.status = status;
    s.utr = utr;
  }

  /** The exact request YouPI's webhook engine would send for a session. */
  webhookFor(
    paymentId: string,
    over: Partial<{
      event: string;
      amountPaise: number;
      utr: string;
      method: string;
      currency: string;
      timestamp: number;
      deliveryId: string;
      secret: string;
    }> = {},
  ): { rawBody: Buffer; headers: Record<string, string> } {
    const s = this.sessions.get(paymentId);
    if (!s) throw new Error(`no session ${paymentId}`);
    const merchant = this.merchants.get(s.merchantId)!;
    const timestamp = over.timestamp ?? Date.now();
    const deliveryId = over.deliveryId ?? randomUUID();
    const event = over.event ?? s.status;
    const amountPaise = over.amountPaise ?? s.amountPaise;
    const payload = {
      event,
      deliveryId,
      timestamp,
      paymentId,
      orderId: s.orderId,
      attemptId: paymentId,
      amount: `${Math.floor(amountPaise / 100)}.${String(amountPaise % 100).padStart(2, '0')}`,
      amountPaise,
      currency: over.currency ?? 'INR',
      method: over.method ?? s.method,
      utr: over.utr ?? s.utr ?? '',
      verificationTag: 'OBSERVED',
      verificationLevel: 1,
      completedAt: new Date(timestamp).toISOString(),
      metadata: {},
      settlementState: event === 'OBSERVED_SUCCESS' ? 'NOT_RECONCILED' : 'NOT_APPLICABLE',
    };
    const raw = JSON.stringify(payload);
    const secret = over.secret ?? merchant.webhookSecret;
    const sign = (data: string) => createHmac('sha256', secret).update(data, 'utf8').digest('hex');
    return {
      rawBody: Buffer.from(raw, 'utf8'),
      headers: {
        'content-type': 'application/json',
        'x-gateway-event': event,
        'x-gateway-signature': `sha256=${sign(raw)}`,
        'x-gateway-signature-v2': `sha256=${sign(`${timestamp}.${raw}`)}`,
        'x-gateway-delivery-id': deliveryId,
        'x-gateway-timestamp': String(timestamp),
      },
    };
  }

  private route(
    method: string,
    url: URL,
    headers: Record<string, string>,
    body: Record<string, unknown>,
  ): [number, unknown] {
    const path = url.pathname;
    const isAdmin = headers.authorization === `Bearer ${this.adminToken}`;

    if (method === 'POST' && path === '/api/v1/payments') {
      const merchant = this.merchants.get(headers['x-merchant-id'] ?? '');
      if (!merchant) return [400, { error: 'Merchant not found or not configured.' }];
      if (headers['x-merchant-key'] !== merchant.apiKey) {
        return [401, { error: 'Invalid merchant key', code: 'INVALID_MERCHANT_KEY' }];
      }
      const [r, p] = String(body.amount ?? '').split('.');
      const amountPaise = Number(r) * 100 + Number((p ?? '0').padEnd(2, '0'));
      const existing = [...this.sessions.values()].find(
        (s) => s.merchantId === merchant.id && s.orderId === body.orderId,
      );
      if (existing && existing.amountPaise !== amountPaise) {
        return [409, { error: 'ORDER_AMOUNT_MISMATCH', code: 'ORDER_AMOUNT_MISMATCH' }];
      }
      const session = existing ?? {
        id: randomUUID(),
        merchantId: merchant.id,
        orderId: String(body.orderId),
        amountPaise,
        status: 'QUEUED',
        method: 'UPI',
        utr: null,
      };
      this.sessions.set(session.id, session);
      return [
        existing ? 200 : 201,
        {
          paymentId: session.id,
          orderId: session.orderId,
          amount: body.amount,
          amountPaise: String(amountPaise),
          status: session.status,
          checkoutUrl: `https://pay.youpi.test/checkout/${session.id}`,
        },
      ];
    }

    const paymentMatch = /^\/api\/v1\/payments\/([^/]+)$/.exec(path);
    if (method === 'GET' && paymentMatch) {
      const s = this.sessions.get(decodeURIComponent(paymentMatch[1]!));
      if (!s) return [404, { error: 'Payment session not found' }];
      const owner = headers['x-merchant-key'] === this.merchants.get(s.merchantId)?.apiKey;
      const terminal = [
        'OBSERVED_SUCCESS',
        'RECONCILED',
        'MANUAL_REVIEW',
        'SUCCESS',
        'FAILED',
        'EXPIRED',
        'CANCELLED',
      ];
      const pub = {
        paymentId: s.id,
        orderId: s.orderId,
        amountPaise: String(s.amountPaise),
        currency: 'INR',
        status: terminal.includes(s.status) ? s.status : s.status,
        method: s.method,
        completedAt: null,
      };
      return [200, owner ? { ...pub, internalStatus: s.status } : pub];
    }

    if (!path.startsWith('/api/v1/admin/')) return [404, { error: 'not found' }];
    if (!isAdmin) return [401, { error: 'Unauthorized' }];

    if (method === 'POST' && path === '/api/v1/admin/merchants') {
      const m: FakeMerchant = {
        id: randomUUID(),
        apiKey: String(body.apiKey),
        webhookSecret: String(body.webhookSecret),
        webhookUrl: String(body.webhookUrl),
        accounts: [],
      };
      if (
        [...this.merchants.values()].some(
          (x) => (x as FakeMerchant & { slug?: string }).slug === body.slug,
        )
      ) {
        return [409, { error: `Merchant with slug '${String(body.slug)}' already exists` }];
      }
      (m as FakeMerchant & { slug?: string }).slug = String(body.slug);
      if (body.upiId) {
        m.accounts.push({
          id: randomUUID(),
          merchantId: m.id,
          upiId: String(body.upiId),
          payeeName: String(body.businessName),
          isActive: true,
        });
      }
      this.merchants.set(m.id, m);
      return [
        201,
        {
          merchant: { id: m.id, slug: body.slug, apiKey: m.apiKey, webhookSecret: m.webhookSecret },
        },
      ];
    }
    const merchantId = url.searchParams.get('merchantId') ?? String(body.merchantId ?? '');
    const merchant = this.merchants.get(merchantId);
    if (method === 'GET' && path === '/api/v1/admin/upi-accounts') {
      if (!merchant) return [404, { error: 'Merchant not found' }];
      return [200, { accounts: merchant.accounts }];
    }
    if (method === 'POST' && path === '/api/v1/admin/upi-accounts') {
      if (!merchant) return [404, { error: 'Merchant not found' }];
      const a = {
        id: randomUUID(),
        merchantId: merchant.id,
        upiId: String(body.upiId),
        payeeName: String(body.payeeName),
        isActive: false,
      };
      merchant.accounts.push(a);
      return [201, { success: true, account: a }];
    }
    const activate = /^\/api\/v1\/admin\/upi-accounts\/([^/]+)\/activate$/.exec(path);
    if (method === 'POST' && activate) {
      for (const m of this.merchants.values()) {
        const target = m.accounts.find((a) => a.id === activate[1]);
        if (target) {
          for (const a of m.accounts) a.isActive = a.id === target.id;
          return [200, { success: true, activeAccount: target }];
        }
      }
      return [404, { error: 'UPI Account not found' }];
    }
    if (method === 'GET' && path === '/api/v1/admin/sms-gateway/pair-qr') {
      if (!merchant) return [404, { error: 'Merchant not found' }];
      const payload = {
        version: 'v1',
        type: 'YOUPI_SMS_GATEWAY_PAIR',
        merchantId: merchant.id,
        token: 'enroll',
        expiresAt: Date.now() + 600_000,
      };
      return [
        200,
        { pairingPayload: JSON.stringify(payload), payload, expiresAt: payload.expiresAt },
      ];
    }
    if (method === 'GET' && path === '/api/v1/admin/sms-gateway/devices') {
      return [200, { devices: this.devices.get(merchantId) ?? [] }];
    }
    return [404, { error: 'not found' }];
  }
}
