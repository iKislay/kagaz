import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { PickupCrypto } from './pickup-crypto.js';

@Global()
@Module({
  providers: [
    {
      provide: PickupCrypto,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new PickupCrypto(config.PICKUP_CODE_PEPPER, config.PICKUP_CODE_ENC_KEY),
    },
  ],
  exports: [PickupCrypto],
})
export class PickupModule {}
