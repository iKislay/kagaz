import { Logger } from '@nestjs/common';
import { AppEnv } from '@kagaz/shared';
import { type OtpProvider } from './otp-provider.js';

export interface DemoOtpMessage {
  phone: string;
  code: string;
  sentAt: Date;
  expiresAt: Date;
}

const INBOX_SIZE = 50;

/** Mask all but the last 4 digits: +919876543210 → +91******3210. */
export function maskPhoneLast4(phone: string): string {
  return phone.length > 7
    ? `${phone.slice(0, 3)}${'*'.repeat(phone.length - 7)}${phone.slice(-4)}`
    : phone;
}

/**
 * DEMO ONLY (P2.2): no SMS is sent. Codes go to an in-memory "OTP inbox" that the admin demo
 * page shows, and to the API log with the phone masked. Refuses to exist in production.
 */
export class DemoOtpProvider implements OtpProvider {
  readonly name = 'demo';
  readonly simulated = true;
  private readonly logger = new Logger('DemoOtpProvider');
  private readonly inbox: DemoOtpMessage[] = [];

  constructor(appEnv: AppEnv) {
    if (appEnv === AppEnv.PRODUCTION) {
      throw new Error('DemoOtpProvider must never be loaded with APP_ENV=production');
    }
  }

  async send(input: { phone: string; code: string; expiresAt: Date }): Promise<void> {
    this.inbox.unshift({ ...input, sentAt: new Date() });
    this.inbox.length = Math.min(this.inbox.length, INBOX_SIZE);
    // Demo channel only: the code is visible in local/demo logs by design (plan P2.2).
    this.logger.log(`[DEMO OTP] ${maskPhoneLast4(input.phone)} code ${input.code}`);
  }

  /** Newest first. */
  messages(): DemoOtpMessage[] {
    return [...this.inbox];
  }
}
