import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig, startupSummary } from './common/config/config.schema.js';

// Local development: read the repo-root .env. Real environments inject variables directly.
// Variables already set in the environment win over the file.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

async function bootstrap(): Promise<void> {
  // Validate before Nest (or any module) loads so a bad config — e.g. mock payments or demo
  // OTP in production — exits non-zero immediately (P3.2, FR-PAY-03).
  const config = loadConfig(process.env);

  const [{ NestFactory }, { Logger }, { AppModule }, { RealtimeIoAdapter }, { default: helmet }] =
    await Promise.all([
      import('@nestjs/core'),
      import('nestjs-pino'),
      import('./app.module.js'),
      import('./modules/realtime/realtime.adapter.js'),
      import('helmet'),
    ]);

  // rawBody: webhook signatures are verified over the exact received bytes (P3.3).
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  // Security headers (nosniff, frame-ancestors none, HSTS outside local …). Pure JSON API: no CSP needs.
  app.use(helmet({ hsts: config.APP_ENV !== 'local' }));
  // Behind a reverse proxy, per-IP rate limits need the client IP (security review M3).
  if (config.TRUST_PROXY !== undefined) {
    app.getHttpAdapter().getInstance().set('trust proxy', config.TRUST_PROXY);
  }
  app.setGlobalPrefix('api');
  // maxAge: browsers cache the preflight, so status polling isn't doubled by OPTIONS requests.
  app.enableCors({ origin: [config.PUBLIC_WEB_URL], credentials: true, maxAge: 600 });
  app.enableShutdownHooks();
  app.useWebSocketAdapter(new RealtimeIoAdapter(app, config.PUBLIC_WEB_URL));

  await app.listen(config.API_PORT);

  app
    .get(Logger)
    .log(`Kaggaz API listening on :${config.API_PORT} | ${startupSummary(config)}`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(`\n[kagaz-api] ${err.message}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
