import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';

/** Global so every module can audit inside its own transactions. */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
