import { Global, Module } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { PickupNumberService } from './pickup-number.service.js';

/** ADR-002 daily pickup number (+ the injectable Clock it reads the business date from). */
@Global()
@Module({
  providers: [Clock, PickupNumberService],
  exports: [Clock, PickupNumberService],
})
export class PickupModule {}
