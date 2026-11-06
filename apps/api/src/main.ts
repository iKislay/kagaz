import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ConfigError, loadConfig, paymentModeOf } from './common/config/config.schema.js';

// Local development: read the repo-root .env. Real environments inject variables directly.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

async function bootstrap(): Promise<void> {
  // Validate before Nest starts so a bad config (e.g. mock payments in production) exits fast.
  const config = loadConfig(process.env);

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  // maxAge: browsers cache the preflight, so status polling isn't doubled by OPTIONS requests.
  app.enableCors({ origin: [config.PUBLIC_WEB_URL], credentials: true, maxAge: 600 });
  app.enableShutdownHooks();

  await app.listen(config.API_PORT);

  const logger = app.get(Logger);
  logger.log(
    `Kagaz API listening on :${config.API_PORT} | APP_ENV=${config.APP_ENV} | PAYMENT=${
      paymentModeOf(config) === 'DEMO' ? 'DEMO (SIMULATED)' : 'LIVE'
    }`,
    'Bootstrap',
  );
}

bootstrap().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(`\n[kagaz-api] ${err.message}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
