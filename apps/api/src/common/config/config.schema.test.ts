import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  environmentProfile,
  loadConfig,
  startupSummary,
  toPublicConfig,
} from './config.schema.js';

const base = {
  APP_ENV: 'local',
  PUBLIC_WEB_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://kagaz:kagaz@localhost:5432/kagaz',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'kagaz-local',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  PAYMENT_PROVIDER: 'demo',
  OTP_PROVIDER: 'demo',
  SESSION_JWT_SECRET: 'x'.repeat(32),
} satisfies NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('accepts a valid local config and applies defaults', () => {
    const config = loadConfig(base);
    expect(config.API_PORT).toBe(4000);
    expect(config.MAX_UPLOAD_BYTES).toBe(26_214_400);
    expect(config.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('reports every missing variable', () => {
    expect(() => loadConfig({ APP_ENV: 'local' })).toThrow(/DATABASE_URL[\s\S]*S3_BUCKET/);
  });

  it('needs ADMIN_EMAIL and ADMIN_PASSWORD together, password ≥ 12 chars', () => {
    expect(() => loadConfig({ ...base, ADMIN_EMAIL: 'a@kaggaz.in' })).toThrow(/both/);
    expect(() =>
      loadConfig({ ...base, ADMIN_EMAIL: 'a@kaggaz.in', ADMIN_PASSWORD: 'short' }),
    ).toThrow(/12 characters/);
    const c = loadConfig({ ...base, ADMIN_EMAIL: 'A@Kaggaz.in', ADMIN_PASSWORD: 'x'.repeat(12) });
    expect(c.ADMIN_EMAIL).toBe('a@kaggaz.in');
  });

  it('rejects short secrets', () => {
    expect(() => loadConfig({ ...base, SESSION_JWT_SECRET: 'short' })).toThrow(
      /SESSION_JWT_SECRET/,
    );
  });

  // PRD FR-PAY-03: the app must fail to start if mock payments are enabled in production.
  it('refuses to start with mock payments in production', () => {
    expect(() => loadConfig({ ...base, APP_ENV: 'production' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, APP_ENV: 'production' })).toThrow(/PAYMENT_PROVIDER=demo/);
  });

  it('refuses to start with demo OTP in production', () => {
    expect(() =>
      loadConfig({ ...base, APP_ENV: 'production', PAYMENT_PROVIDER: 'razorpay' }),
    ).toThrow(/OTP_PROVIDER=demo/);
  });

  it('allows mock payments in demo and staging', () => {
    const secret = { DEMO_WEBHOOK_SECRET: 'w'.repeat(32) };
    expect(loadConfig({ ...base, ...secret, APP_ENV: 'demo' }).PAYMENT_PROVIDER).toBe('demo');
    expect(loadConfig({ ...base, ...secret, APP_ENV: 'staging' }).PAYMENT_PROVIDER).toBe('demo');
  });

  it('requires a real demo webhook secret outside local', () => {
    expect(() => loadConfig({ ...base, APP_ENV: 'demo' })).toThrow(/DEMO_WEBHOOK_SECRET/);
    expect(loadConfig(base).DEMO_WEBHOOK_SECRET).toBeUndefined();
  });

  it('environment matrix: demo features only outside production', () => {
    for (const env of ['local', 'demo', 'staging'] as const) {
      expect(environmentProfile(env)).toMatchObject({
        demoPaymentsAllowed: true,
        demoOtpAllowed: true,
        demoControlsAllowed: true,
      });
    }
    expect(environmentProfile('production')).toEqual({
      demoPaymentsAllowed: false,
      demoOtpAllowed: false,
      demoControlsAllowed: false,
      secureCookies: true,
    });
    expect(environmentProfile('local').secureCookies).toBe(false);
  });

  it('logs the mode at startup', () => {
    expect(startupSummary(loadConfig(base))).toBe(
      'APP_ENV=local | PAYMENT=DEMO (SIMULATED) | OTP=DEMO (NO SMS) | DEMO_CONTROLS=ON',
    );
  });

  it('refuses placeholder secrets in staging', () => {
    expect(() =>
      loadConfig({
        ...base,
        APP_ENV: 'staging',
        SESSION_JWT_SECRET: 'change-me-session-secret-at-least-32-chars',
      }),
    ).toThrow(/placeholder/);
  });

  it('refuses placeholder secrets in demo too, whatever their case (security review H2)', () => {
    const secret = { DEMO_WEBHOOK_SECRET: 'w'.repeat(32) };
    expect(() =>
      loadConfig({
        ...base,
        ...secret,
        APP_ENV: 'demo',
        SESSION_JWT_SECRET: 'CHANGE-me-session-secret-at-least-32-chars',
      }),
    ).toThrow(/placeholder/);
    expect(() =>
      loadConfig({
        ...base,
        ...secret,
        APP_ENV: 'demo',
        DEMO_WEBHOOK_SECRET: 'CHANGE-me-'.repeat(4),
      }),
    ).toThrow(/placeholder/);
  });

  it('caps signed-URL lifetimes (invariant 11)', () => {
    expect(() => loadConfig({ ...base, UPLOAD_URL_TTL_SECONDS: '601' })).toThrow();
    expect(() => loadConfig({ ...base, DOWNLOAD_URL_TTL_SECONDS: '301' })).toThrow();
  });

  it('exposes DEMO payment mode in public config', () => {
    expect(toPublicConfig(loadConfig(base))).toEqual({
      appEnv: 'local',
      paymentMode: 'DEMO',
      otpMode: 'DEMO',
      demoControls: true,
      limits: { maxUploadBytes: 26_214_400, maxPages: 300, maxCopies: 20, maxSides: 1000 },
      support: { phone: null, whatsapp: null, email: null },
    });
  });

  it('support contact is optional, normalized, and validated', () => {
    const c = loadConfig({
      ...base,
      SUPPORT_PHONE: '98765 43210',
      SUPPORT_WHATSAPP: '',
      SUPPORT_EMAIL: 'help@kaggaz.in',
    });
    expect(toPublicConfig(c).support).toEqual({
      phone: '+919876543210',
      whatsapp: null,
      email: 'help@kaggaz.in',
    });
    expect(() => loadConfig({ ...base, SUPPORT_PHONE: 'call us' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, SUPPORT_EMAIL: 'nope' })).toThrow(ConfigError);
  });

  it('MIN_AGENT_VERSION is optional; empty means no minimum', () => {
    expect(loadConfig(base).MIN_AGENT_VERSION).toBeUndefined();
    expect(loadConfig({ ...base, MIN_AGENT_VERSION: '' }).MIN_AGENT_VERSION).toBeUndefined();
    expect(loadConfig({ ...base, MIN_AGENT_VERSION: '0.3.0' }).MIN_AGENT_VERSION).toBe('0.3.0');
    expect(() => loadConfig({ ...base, MIN_AGENT_VERSION: 'latest' })).toThrow(ConfigError);
  });
});
