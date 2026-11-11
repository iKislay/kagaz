/**
 * Delivery channel for customer sign-in codes (PRD D8/D9). A live SMS vendor implements the
 * same interface later; until then only the demo provider exists.
 */
export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

export interface OtpProvider {
  readonly name: string;
  /** True when no SMS is sent (DEMO). */
  readonly simulated: boolean;
  send(input: { phone: string; code: string; expiresAt: Date }): Promise<void>;
}
