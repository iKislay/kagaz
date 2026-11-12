import { z } from 'zod';
import { AppEnv, AppEnvSchema, PaymentMode, type PublicConfig } from '@kagaz/shared';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const int = (def: number) => z.coerce.number().int().positive().default(def);
const secret = (name: string) =>
  z.string().min(32, `${name} must be at least 32 characters (use a random value)`);

/**
 * Environment schema. Every variable is documented in docs/IMPLEMENTATION_PLAN.md Appendix B.
 * Parsed once at boot; the process exits if anything is missing or invalid.
 */
export const EnvSchema = z.object({
  APP_ENV: AppEnvSchema,
  // Not PORT: dev tooling sets PORT for the web server, which would hijack the API port.
  API_PORT: int(4000),
  PUBLIC_WEB_URL: z.url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().startsWith('postgresql://'),

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default('auto'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool.default(false),
  // Invariant 11: upload ≤ 10 min, download ≤ 5 min.
  UPLOAD_URL_TTL_SECONDS: int(600).pipe(z.number().max(600)),
  DOWNLOAD_URL_TTL_SECONDS: int(300).pipe(z.number().max(300)),

  MAX_UPLOAD_BYTES: int(26_214_400),
  MAX_PAGES: int(300),
  MAX_COPIES: int(20),
  MAX_SIDES: int(1000),

  /**
   * Online payment gateway. `none` (default, ADR-003): online payments are off and customers pay
   * at the counter. `demo` is the simulated gateway, kept only for automated tests/tooling.
   */
  PAYMENT_PROVIDER: z.enum(['none', 'demo', 'razorpay', 'cashfree']).default('none'),
  OTP_PROVIDER: z.enum(['demo']),
  DEMO_WEBHOOK_SECRET: z.string().optional(),
  /** Demo gateway only: delay before simulated webhooks are delivered (P3.5). */
  DEMO_WEBHOOK_DELAY_MS: z.coerce.number().int().nonnegative().default(300),
  /** Demo gateway only: PENDING outcome resolves to PAID after this many seconds. */
  DEMO_PENDING_RESOLVE_SECONDS: int(10),

  SESSION_JWT_SECRET: secret('SESSION_JWT_SECRET'),
  PICKUP_CODE_PEPPER: secret('PICKUP_CODE_PEPPER'),
  PICKUP_CODE_ENC_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
    message: 'PICKUP_CODE_ENC_KEY must be 32 random bytes, base64-encoded',
  }),

  PRINTER_LEASE_TTL_SECONDS: int(60),
  DEVICE_ONLINE_THRESHOLD_SECONDS: int(45),
  /**
   * Express `trust proxy` (hop count like "1", or a CIDR/IP list). Unset = trust nothing (direct
   * exposure). Set it behind a reverse proxy so per-IP rate limits see real client IPs.
   */
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : /^\d+$/.test(v) ? Number(v) : v)),
  RETENTION_AFTER_COLLECTED_HOURS: int(24),
  /** PRD §14.3 dispute window: files of REJECTED/REFUNDED orders are kept 7 days. */
  RETENTION_AFTER_REJECTED_HOURS: int(168),
  UNPAID_ORDER_EXPIRY_HOURS: int(24),
  /** Agents older than this get 426 AGENT_UPGRADE_REQUIRED on shop endpoints (P4.4). */
  MIN_AGENT_VERSION: z
    .string()
    .regex(/^\d+(\.\d+){0,3}$/, 'MIN_AGENT_VERSION must look like 0.3.0')
    .optional()
    .or(z.literal('').transform(() => undefined)),

  SENTRY_DSN: z.string().optional(),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Placeholder secrets shipped in .env.example; never acceptable outside local/demo. */
const PLACEHOLDER = /^change-me/i;

/**
 * Parse and validate the environment, then apply the safety guards from CLAUDE.md:
 * mock payments / demo OTP must never run in production (PRD FR-PAY-03).
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${issues}`);
  }
  const config = parsed.data;

  if (config.APP_ENV === AppEnv.PRODUCTION) {
    if (config.PAYMENT_PROVIDER === 'demo') {
      throw new ConfigError(
        'Refusing to start: PAYMENT_PROVIDER=demo (mock payments) is not allowed when APP_ENV=production.',
      );
    }
    if (config.OTP_PROVIDER === 'demo') {
      throw new ConfigError(
        'Refusing to start: OTP_PROVIDER=demo is not allowed when APP_ENV=production.',
      );
    }
  }

  // Every shared environment (demo, staging, production) must use its own secrets (SEC H2).
  if (config.APP_ENV !== AppEnv.LOCAL) {
    for (const key of [
      'SESSION_JWT_SECRET',
      'PICKUP_CODE_PEPPER',
      'DEMO_WEBHOOK_SECRET',
    ] as const) {
      const value = config[key];
      if (value && PLACEHOLDER.test(value)) {
        throw new ConfigError(`Refusing to start: ${key} still has its placeholder value.`);
      }
    }
    if (PLACEHOLDER.test(Buffer.from(config.PICKUP_CODE_ENC_KEY, 'base64').toString('latin1'))) {
      throw new ConfigError('Refusing to start: PICKUP_CODE_ENC_KEY is the local development key.');
    }
  }

  const profile = environmentProfile(config.APP_ENV);
  if (config.PAYMENT_PROVIDER === 'demo' && config.APP_ENV !== AppEnv.LOCAL) {
    if (!config.DEMO_WEBHOOK_SECRET || config.DEMO_WEBHOOK_SECRET.length < 32) {
      throw new ConfigError(
        `Refusing to start: DEMO_WEBHOOK_SECRET (≥ 32 chars) is required for demo payments in APP_ENV=${config.APP_ENV}.`,
      );
    }
  }
  if (!profile.demoPaymentsAllowed && config.PAYMENT_PROVIDER === 'demo') {
    throw new ConfigError(`Refusing to start: demo payments are not allowed in ${config.APP_ENV}.`);
  }

  return config;
}

/**
 * Environment matrix (P3.2). Each environment also has its own database, bucket, domain and
 * keys — configured by its env vars, never shared.
 *
 * | APP_ENV    | demo payments | demo OTP | demo controls | Secure cookies |
 * | ---------- | ------------- | -------- | ------------- | -------------- |
 * | local      | yes           | yes      | yes           | no             |
 * | demo       | yes           | yes      | yes           | yes            |
 * | staging    | yes           | yes      | yes           | yes            |
 * | production | **never**     | **never**| **never**     | yes            |
 */
export interface EnvironmentProfile {
  demoPaymentsAllowed: boolean;
  demoOtpAllowed: boolean;
  /** Admin demo controls (OTP inbox, payment outcome simulation). */
  demoControlsAllowed: boolean;
  secureCookies: boolean;
}

export function environmentProfile(appEnv: AppEnv): EnvironmentProfile {
  const production = appEnv === AppEnv.PRODUCTION;
  return {
    demoPaymentsAllowed: !production,
    demoOtpAllowed: !production,
    demoControlsAllowed: !production,
    secureCookies: appEnv !== AppEnv.LOCAL,
  };
}

/** Demo controls are on only when allowed AND something is actually simulated. */
export function demoControlsEnabled(config: AppConfig): boolean {
  return (
    environmentProfile(config.APP_ENV).demoControlsAllowed &&
    (config.PAYMENT_PROVIDER === 'demo' || config.OTP_PROVIDER === 'demo')
  );
}

/** One line logged at boot so operators can see the mode at a glance. */
export function startupSummary(config: AppConfig): string {
  return [
    `APP_ENV=${config.APP_ENV}`,
    `PAYMENT=${
      paymentModeOf(config) === PaymentMode.DEMO
        ? 'DEMO (SIMULATED)'
        : onlinePaymentsEnabled(config)
          ? `LIVE (${config.PAYMENT_PROVIDER}) + COUNTER`
          : 'COUNTER ONLY'
    }`,
    `OTP=${config.OTP_PROVIDER === 'demo' ? 'DEMO (NO SMS)' : 'LIVE'}`,
    `DEMO_CONTROLS=${demoControlsEnabled(config) ? 'ON' : 'OFF'}`,
  ].join(' | ');
}

export function paymentModeOf(config: AppConfig): PaymentMode {
  return config.PAYMENT_PROVIDER === 'demo' ? PaymentMode.DEMO : PaymentMode.LIVE;
}

/**
 * True when customers can pay online through a live gateway. The simulated demo gateway never
 * counts: customers always see "Pay online" disabled unless a real provider is configured.
 */
export function onlinePaymentsEnabled(config: AppConfig): boolean {
  return config.PAYMENT_PROVIDER === 'razorpay' || config.PAYMENT_PROVIDER === 'cashfree';
}

export function toPublicConfig(config: AppConfig): PublicConfig {
  return {
    appEnv: config.APP_ENV,
    paymentMode: paymentModeOf(config),
    onlinePayments: onlinePaymentsEnabled(config),
    otpMode: config.OTP_PROVIDER === 'demo' ? PaymentMode.DEMO : PaymentMode.LIVE,
    demoControls: demoControlsEnabled(config),
    limits: {
      maxUploadBytes: config.MAX_UPLOAD_BYTES,
      maxPages: config.MAX_PAGES,
      maxCopies: config.MAX_COPIES,
      maxSides: config.MAX_SIDES,
    },
  };
}
