import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import { type Response } from 'express';
import { type Health, type PublicConfig } from '@kagaz/shared';
import { APP_CONFIG } from '../common/config/config.module.js';
import { type AppConfig, toPublicConfig } from '../common/config/config.schema.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { StorageService } from '../modules/files/storage.service.js';
import { APP_VERSION } from '../version.js';

const DEPENDENCY_TIMEOUT_MS = 3000;

async function check(probe: () => Promise<void>): Promise<'ok' | 'error'> {
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), DEPENDENCY_TIMEOUT_MS).unref(),
      ),
    ]);
    return 'ok';
  } catch {
    return 'error';
  }
}

@Controller()
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Liveness + readiness. Returns 503 when a dependency is down so uptime checks notice. */
  @Get('health')
  async health(@Res({ passthrough: true }) res: Response): Promise<Health> {
    const [db, storage] = await Promise.all([
      check(() => this.prisma.ping()),
      check(() => this.storage.ping()),
    ]);
    const status = db === 'ok' && storage === 'ok' ? 'ok' : 'error';
    if (status !== 'ok') res.status(503);
    return { status, db, storage, version: APP_VERSION, time: new Date().toISOString() };
  }

  /** Public runtime config: environment, payment mode (drives the DEMO banner) and limits. */
  @Get('config')
  @HttpCode(200)
  publicConfig(): PublicConfig {
    return toPublicConfig(this.config);
  }
}
