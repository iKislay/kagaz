/**
 * Helpers shared by the Kaggaz dev/ops scripts (sim-agent, load-orders, verify-run, demo-reset).
 * Scripts run with tsx from the repo root package `@kagaz/scripts`; they talk to the real API
 * over HTTP exactly like the website and the Windows app do.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Loads the repo-root .env (like the API does locally). Real env vars win. */
export function loadRootEnv(): void {
  const file = join(REPO_ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

type Spec = Record<string, { type: 'string' | 'boolean'; default?: string | boolean }>;

/** `pnpm x -- --flag v` passes a literal `--`; drop it so parseArgs sees the flags. */
export function cliArgs<S extends Spec>(spec: S) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: spec,
    strict: true,
    allowPositionals: false,
  });
  // parseArgs' generic result type can't be narrowed through a generic spec; shape is per spec.
  return values as unknown as {
    [K in keyof S]: S[K]['type'] extends 'boolean' ? boolean : string;
  };
}

export function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value === undefined || value === '' || !Number.isFinite(n) ? fallback : n;
}

export function defaultApiUrl(): string {
  return `http://localhost:${process.env.API_PORT ?? '4000'}/api`;
}

/** Per-API scratch state (sim-agent device tokens, run manifests). Never committed. */
export function stateDir(api: string): string {
  const u = new URL(api);
  const dir = join(tmpdir(), 'kagaz-scripts', `${u.hostname}-${u.port || '80'}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const randInt = (min: number, max: number) =>
  min + Math.floor(Math.random() * (max - min + 1));
export const chance = (p: number) => Math.random() < p;
export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Adds an Idempotency-Key (mutating shop/agent endpoints accept one). */
  idempotent?: boolean;
}

/** Minimal JSON client: errors become ApiError with the API's stable error code. */
export class ApiClient {
  constructor(
    readonly base: string,
    private readonly defaultHeaders: () => Record<string, string> = () => ({}),
  ) {}

  async call<T>(path: string, opts: CallOptions = {}): Promise<T> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(opts.idempotent ? { 'Idempotency-Key': randomUUID() } : {}),
          ...this.defaultHeaders(),
          ...opts.headers,
        },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      });
    } catch (err) {
      throw new ApiError(0, 'API_UNREACHABLE', `${method} ${path}: ${(err as Error).message}`);
    }
    const json = (await res.json().catch(() => null)) as
      (T & { error?: { code?: string; message?: string } }) | null;
    if (!res.ok) {
      throw new ApiError(
        res.status,
        json?.error?.code ?? `HTTP_${res.status}`,
        `${method} ${path} → ${res.status} ${json?.error?.code ?? ''} ${json?.error?.message ?? ''}`.trim(),
      );
    }
    return json as T;
  }
}

export function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}
