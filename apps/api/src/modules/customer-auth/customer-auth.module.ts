import { Module } from '@nestjs/common';
import { CustomerSessionService } from '../../common/auth/customer-session.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { AdminAuthModule } from '../admin/auth/auth.module.js';
import { CustomerAuthController, DemoOtpInboxController } from './customer-auth.controller.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { DemoOtpProvider } from './demo-otp.provider.js';
import { DISABLED_OTP, OTP_PROVIDER, type OtpProvider } from './otp-provider.js';

/** Customer identity: phone OTP, session cookie, "my orders" (P2.2). */
@Module({
  imports: [AdminAuthModule],
  controllers: [CustomerAuthController, DemoOtpInboxController],
  providers: [
    CustomerAuthService,
    CustomerSessionService,
    {
      provide: OTP_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): OtpProvider => {
        switch (config.OTP_PROVIDER) {
          case 'demo':
            // Throws in production (and loadConfig already refuses demo OTP there).
            return new DemoOtpProvider(config.APP_ENV);
          case 'none':
            return DISABLED_OTP;
          default:
            // A live SMS vendor is undecided (D9).
            throw new Error(`OTP provider "${String(config.OTP_PROVIDER)}" is not implemented`);
        }
      },
    },
  ],
  exports: [CustomerSessionService, OTP_PROVIDER],
})
export class CustomerAuthModule {}
