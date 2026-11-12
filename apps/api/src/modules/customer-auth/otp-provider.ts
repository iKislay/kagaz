/**
 * Delivery channel for customer sign-in codes (PRD D8/D9). A live SMS vendor implements the
 * same interface later; until then only the demo provider exists.
 */
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/http/api-exception.filter.js';

export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

/** OTP_PROVIDER=none: customer sign-in is off until an SMS vendor is chosen (D9). */
export const DISABLED_OTP: OtpProvider = {
  name: 'none',
  simulated: false,
  send: () =>
    Promise.reject(
      new AppError(
        'SIGN_IN_UNAVAILABLE',
        'Sign-in is not available yet. Use the tracking link from your order.',
        HttpStatus.SERVICE_UNAVAILABLE,
      ),
    ),
};

export interface OtpProvider {
  readonly name: string;
  /** True when no SMS is sent (DEMO). */
  readonly simulated: boolean;
  send(input: { phone: string; code: string; expiresAt: Date }): Promise<void>;
}
