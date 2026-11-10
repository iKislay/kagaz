import { Injectable } from '@nestjs/common';

/**
 * The current time, injectable so tests can move it (e.g. across midnight Asia/Kolkata for
 * the ADR-002 daily pickup number). Production code that depends on the business date reads
 * the time from here.
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
