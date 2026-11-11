/**
 * Headless simulated shop agent (P4.7) — stands in for a shop without hardware. Uses the real
 * device API exactly like the Windows app, but NEVER prints: it downloads the packet, checks its
 * SHA-256 and reports spooler progress as if a printer had taken the job.
 *
 *   pnpm sim:agent -- --shop demo-shop-b [--api http://localhost:4105/api] [--code ABCD-EFGH]
 *        [--reject-rate 0.03] [--fail-rate 0.03] [--min-delay 100] [--max-delay 600]
 *        [--poll 5] [--heartbeat 15] [--exit-when-idle 0] [--duration 0] [--fresh] [--quiet]
 *
 * Without --code it mints a one-time pairing code directly in the DB (refused when
 * APP_ENV=production). The device token is cached in the OS temp dir and reused next run.
 * Don't point it at the shop whose real Windows app/printer you are demoing: it registers a
 * simulated default printer for that shop.
 */
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { io } from 'socket.io-client';
import {
  type EnrollDeviceResponse,
  type LeaseResponse,
  REALTIME_PATH,
  RealtimeEvent,
  RealtimeNamespace,
  type ShopJob,
  type ShopPrinter,
} from '@kagaz/shared';
import { formatCode, randomCode, sha256Hex } from '../apps/api/src/common/crypto/tokens.js';
import { type AgentState, emptyStats, readAgentState, writeAgentState } from './lib/agent-state.js';
import {
  ApiClient,
  ApiError,
  chance,
  cliArgs,
  defaultApiUrl,
  loadRootEnv,
  num,
  randInt,
  sleep,
} from './lib/common.js';
import { openDb, refuseInProduction } from './lib/db.js';

loadRootEnv();
const args = cliArgs({
  shop: { type: 'string', default: 'demo-shop-b' },
  api: { type: 'string' },
  code: { type: 'string' },
  operator: { type: 'string' },
  'operator-password': { type: 'string' },
  'reject-rate': { type: 'string', default: '0.03' },
  'fail-rate': { type: 'string', default: '0.03' },
  'min-delay': { type: 'string', default: '100' },
  'max-delay': { type: 'string', default: '600' },
  poll: { type: 'string', default: '5' },
  heartbeat: { type: 'string', default: '15' },
  'exit-when-idle': { type: 'string', default: '0' },
  duration: { type: 'string', default: '0' },
  'no-download': { type: 'boolean', default: false },
  'no-socket': { type: 'boolean', default: false },
  fresh: { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false },
});

const API = (args.api ?? defaultApiUrl()).replace(/\/$/, '');
const SLUG = args.shop;
const APP_VERSION = 'sim-0.3.0';
const REJECT_RATE = num(args['reject-rate'], 0.03);
const FAIL_RATE = num(args['fail-rate'], 0.03);
const MIN_DELAY = num(args['min-delay'], 100);
const MAX_DELAY = Math.max(MIN_DELAY, num(args['max-delay'], 600));
const POLL_MS = num(args.poll, 5) * 1000;
const HEARTBEAT_MS = num(args.heartbeat, 15) * 1000;
const IDLE_EXIT_MS = num(args['exit-when-idle'], 0) * 1000;
const DURATION_MS = num(args.duration, 0) * 1000;
const startedAt = Date.now();

let state!: AgentState;
const activePrintJobIds = new Set<string>();
const api = new ApiClient(API, () => ({
  'X-Agent-Version': APP_VERSION,
  ...(state?.deviceToken ? { Authorization: `Bearer ${state.deviceToken}` } : {}),
  ...(state?.operatorToken ? { 'X-Operator-Token': state.operatorToken } : {}),
}));

function log(msg: string): void {
  if (!args.quiet) console.log(`${new Date().toISOString().slice(11, 23)} [${SLUG}] ${msg}`);
}
function countError(err: unknown): string {
  const code = err instanceof ApiError ? err.code : 'EXCEPTION';
  state.stats.errors[code] = (state.stats.errors[code] ?? 0) + 1;
  return code;
}
const think = () => sleep(randInt(MIN_DELAY, MAX_DELAY));
const isNotFound = (err: unknown) => err instanceof ApiError && err.status === 404;

// ─── Pairing ───

async function mintPairingCode(): Promise<string> {
  refuseInProduction('mint a device pairing code');
  const db = openDb();
  try {
    const shop = await db.shop.findUnique({ where: { slug: SLUG }, select: { id: true } });
    if (!shop) throw new Error(`Shop "${SLUG}" not found (run db:seed).`);
    const code = randomCode(8);
    await db.enrollmentCode.create({
      data: {
        shopId: shop.id,
        codeHash: sha256Hex(code),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    return formatCode(code);
  } finally {
    await db.$disconnect();
  }
}

async function pair(): Promise<void> {
  const cached = args.fresh ? null : readAgentState(API, SLUG);
  if (cached) {
    state = cached;
    try {
      await api.call<ShopPrinter[]>('/shop/printers');
      state.stats = emptyStats();
      log(`reusing paired device ${state.deviceId}`);
      return;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
      log('cached device token rejected (revoked?) — pairing again');
    }
  }
  const code = args.code ?? (await mintPairingCode());
  const enrolled = await new ApiClient(API).call<EnrollDeviceResponse>('/devices/enroll', {
    body: { code, name: `Sim agent ${SLUG} @ ${hostname()}`, appVersion: APP_VERSION },
  });
  state = {
    api: API,
    shopSlug: SLUG,
    shopId: enrolled.shop.id,
    shopName: enrolled.shop.name,
    deviceId: enrolled.device.id,
    deviceToken: enrolled.deviceToken,
    operatorToken: null,
    printerId: null,
    stats: emptyStats(),
  };
  log(`paired as device ${state.deviceId} for ${state.shopName}`);
}

/** Operator session (contract §4). Older APIs without the endpoint: carry on without one. */
async function operatorLogin(): Promise<void> {
  const letter = /-([a-z])$/.exec(SLUG)?.[1] ?? 'a';
  const login = args.operator ?? `operator-${letter}@kagaz.local`;
  const password = args['operator-password'] ?? process.env.SEED_STAFF_PASSWORD ?? 'kagaz-demo-123';
  try {
    const res = await api.call<{ operatorToken: string }>('/shop/operator/login', {
      body: { login, password },
    });
    state.operatorToken = res.operatorToken;
    log(`operator ${login} signed in`);
  } catch (err) {
    state.operatorToken = null;
    if (isNotFound(err)) log('operator login endpoint not available — device-only mode');
    else log(`operator login failed (${countError(err)}) — continuing without operator`);
  }
}

async function registerPrinter(): Promise<void> {
  const printers = await api.call<ShopPrinter[]>('/shop/printers', {
    method: 'PUT',
    idempotent: true,
    body: {
      printers: [
        {
          printerName: `Kagaz Simulated Printer (${SLUG})`,
          displayName: 'Simulated printer',
          colourCapable: true,
          duplexCapable: true,
          capabilitiesConfirmed: true,
          isDefault: true,
        },
      ],
    },
  });
  state.printerId = printers.find((p) => p.isDefault)?.id ?? printers[0]?.id ?? null;
}

// ─── Heartbeat (contract §1, with fallback to the Phase 1 shape/route) ───

let legacyHeartbeat = false;
let heartbeatPath = '/shop/heartbeat';

async function heartbeat(): Promise<void> {
  const printers = state.printerId ? [{ printerId: state.printerId, status: 'READY' }] : [];
  const body = legacyHeartbeat
    ? { appVersion: APP_VERSION, printers }
    : {
        appVersion: APP_VERSION,
        os: `simulated (${process.platform})`,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        queueDepth: activePrintJobIds.size,
        activePrintJobIds: [...activePrintJobIds],
        printers,
      };
  try {
    await api.call(heartbeatPath, { body });
    state.stats.heartbeats++;
  } catch (err) {
    if (isNotFound(err) && heartbeatPath !== '/devices/heartbeat') {
      heartbeatPath = '/devices/heartbeat';
      return heartbeat();
    }
    if (err instanceof ApiError && err.status === 400 && !legacyHeartbeat) {
      legacyHeartbeat = true;
      return heartbeat();
    }
    log(`heartbeat failed: ${countError(err)}`);
  }
}

// ─── Work loop ───

let wake: (() => void) | null = null;
let dirty = false;
function poke(): void {
  dirty = true;
  wake?.();
}
function waitForWork(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  }).then(() => {
    wake = null;
  });
}

async function listJobs(): Promise<ShopJob[]> {
  return (await api.call<{ jobs: ShopJob[] }>('/shop/jobs')).jobs;
}

async function review(job: ShopJob): Promise<void> {
  await think();
  if (chance(REJECT_RATE)) {
    await api.call(`/shop/jobs/${job.orderId}/reject`, {
      idempotent: true,
      body: { reasonCode: 'OUT_OF_SUPPLIES', note: 'Simulated rejection (load test)' },
    });
    state.stats.rejected++;
    log(`${job.publicRef} rejected`);
  } else {
    await api.call(`/shop/jobs/${job.orderId}/accept`, { idempotent: true, body: {} });
    state.stats.accepted++;
    log(`${job.publicRef} accepted`);
  }
}

async function verifyPacket(lease: LeaseResponse): Promise<boolean> {
  if (args['no-download']) return true;
  const res = await fetch(lease.downloadUrl); // signed URL: never logged
  if (!res.ok) throw new Error(`packet download failed: ${res.status}`);
  const sha = createHash('sha256')
    .update(Buffer.from(await res.arrayBuffer()))
    .digest('hex');
  return sha === lease.sha256;
}

/** Lease → (download + checksum) → SUBMITTED → SPOOLER_COMPLETE (→ READY on the server, ADR-002). */
async function printOne(job: ShopJob): Promise<void> {
  const printJobId = job.printJob!.id;
  const lease = await api.call<LeaseResponse>(`/shop/print-jobs/${printJobId}/lease`, {
    idempotent: true,
    body: {},
  });
  state.stats.leased++;
  activePrintJobIds.add(printJobId);
  try {
    const report = (body: object) =>
      api.call<ShopJob>(`/shop/print-jobs/${printJobId}/status`, { idempotent: true, body });

    if (!(await verifyPacket(lease))) {
      state.stats.checksumMismatches++;
      await report({ status: 'FAILED', error: 'Packet checksum mismatch (simulated agent)' });
      log(`${job.publicRef} A${lease.attempt} checksum mismatch → FAILED`);
      return;
    }
    await think();
    if (chance(FAIL_RATE)) {
      await report({ status: 'FAILED', error: 'Simulated paper jam' });
      state.stats.printFailed++;
      log(`${job.publicRef} A${lease.attempt} simulated failure → needs operator check`);
      await resolveFailed(job);
      return;
    }
    await report({ status: 'SUBMITTED', spoolerJobId: randInt(1, 65_000) });
    await think();
    const done = await report({ status: 'SPOOLER_COMPLETE' });
    state.stats.printed++;
    if (done.status === 'READY_FOR_PICKUP') state.stats.ready++;
    log(`${job.publicRef} A${lease.attempt} ${lease.pageCount} sheets "printed" → READY`);
  } finally {
    activePrintJobIds.delete(printJobId);
  }
}

/** Operator reprint after a failure (contract §2). Skipped when the endpoint doesn't exist. */
async function resolveFailed(job: ShopJob): Promise<void> {
  try {
    await api.call(`/shop/jobs/${job.orderId}/resolve`, {
      idempotent: true,
      body: { action: 'REPRINT', confirm: true, note: 'Simulated operator reprint' },
    });
    log(`${job.publicRef} reprint requested (new attempt)`);
  } catch (err) {
    if (!isNotFound(err)) log(`${job.publicRef} resolve failed: ${countError(err)}`);
  }
}

/** One pass over the shop queue. Returns true if anything was done. */
async function cycle(): Promise<boolean> {
  let worked = false;
  for (const job of (await listJobs()).filter((j) => j.status === 'PENDING_REVIEW')) {
    try {
      await review(job);
      worked = true;
    } catch (err) {
      log(`${job.publicRef} review failed: ${countError(err)}`);
    }
  }
  // FIFO per printer: oldest paid first; the API refuses anything else (NOT_NEXT_IN_QUEUE).
  const jobs = await listJobs();
  const printable = jobs
    .filter((j) => j.status === 'QUEUED' && j.printJob?.status === 'READY')
    .sort((a, b) => (a.paidAt ?? a.createdAt).localeCompare(b.paidAt ?? b.createdAt));
  for (const job of printable) {
    try {
      await printOne(job);
      worked = true;
    } catch (err) {
      log(`${job.publicRef} print failed: ${countError(err)}`);
      break; // re-list next cycle; queue order may have changed
    }
  }
  return worked;
}

function connectSocket(): () => void {
  if (args['no-socket']) return () => undefined;
  const socket = io(`${new URL(API).origin}${RealtimeNamespace.SHOP}`, {
    path: REALTIME_PATH,
    auth: { token: state.deviceToken },
    transports: ['websocket'],
    reconnectionDelayMax: 10_000,
  });
  socket.on('connect', () => {
    state.stats.socketConnects++;
    poke(); // reconcile after (re)connect
  });
  socket.on('connect_error', (err) => log(`socket refused: ${err.message}`));
  for (const event of [
    RealtimeEvent.JOB_CREATED,
    RealtimeEvent.JOB_UPDATED,
    RealtimeEvent.SHOP_MODE_CHANGED,
  ]) {
    socket.on(event, (payload?: { at?: string }) => {
      state.stats.hints[event] = (state.stats.hints[event] ?? 0) + 1;
      // Commit → hint received (same machine clock in local runs).
      if (
        event === RealtimeEvent.JOB_CREATED &&
        payload?.at &&
        state.stats.hintLatencyMs.length < 5000
      )
        state.stats.hintLatencyMs.push(Date.now() - Date.parse(payload.at));
      if (event !== RealtimeEvent.JOB_UPDATED) poke();
    });
  }
  socket.on(RealtimeEvent.DEVICE_REVOKED, () => {
    log('device revoked by the server — stopping');
    stopping = true;
    poke();
  });
  return () => socket.disconnect();
}

let stopping = false;

async function main(): Promise<void> {
  await pair();
  await operatorLogin();
  await registerPrinter();
  writeAgentState(state);
  await heartbeat();
  const hb = setInterval(() => void heartbeat(), HEARTBEAT_MS);
  const closeSocket = connectSocket();
  const persist = setInterval(() => {
    state.stats.updatedAt = new Date().toISOString();
    writeAgentState(state);
  }, 2000);

  process.on('SIGINT', () => {
    stopping = true;
    poke();
  });
  log(`running (poll ${POLL_MS / 1000}s, heartbeat ${HEARTBEAT_MS / 1000}s) — Ctrl+C to stop`);

  let lastWork = Date.now();
  while (!stopping) {
    dirty = false;
    try {
      if (await cycle()) lastWork = Date.now();
    } catch (err) {
      log(`cycle error: ${countError(err)} ${(err as Error).message}`);
    }
    if (DURATION_MS && Date.now() - startedAt > DURATION_MS) break;
    if (IDLE_EXIT_MS && Date.now() - lastWork > IDLE_EXIT_MS) break;
    if (!dirty && !stopping) await waitForWork(POLL_MS);
  }

  clearInterval(hb);
  clearInterval(persist);
  closeSocket();
  state.stats.updatedAt = new Date().toISOString();
  writeAgentState(state);
  const s = state.stats;
  console.log(
    `[${SLUG}] stopped: accepted ${s.accepted}, rejected ${s.rejected}, printed ${s.printed}, ` +
      `failed ${s.printFailed}, ready ${s.ready}, hints ${JSON.stringify(s.hints)}, ` +
      `errors ${JSON.stringify(s.errors)}`,
  );
}

main().catch((err: unknown) => {
  console.error(`[${SLUG}] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
