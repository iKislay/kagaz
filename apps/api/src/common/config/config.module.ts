import { Global, Module } from '@nestjs/common';
import { type AppConfig, loadConfig } from './config.schema.js';

/** Injection token for the validated AppConfig. */
export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(process.env),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
