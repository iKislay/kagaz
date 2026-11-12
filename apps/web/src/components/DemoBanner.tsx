import { DEMO_PAYMENT_BANNER, PaymentMode } from '@kagaz/shared';
import { getPublicConfig } from '@/lib/api';

/**
 * Persistent notice driven by GET /api/config (PRD FR-CUST-09).
 * While payments are simulated it is always shown and cannot be dismissed — styled as a calm
 * macOS-style notice bar (CLAUDE.md "Design language"), not an alarm.
 * If the API is unreachable we cannot prove payments are live, so we say so instead.
 */
export async function DemoBanner() {
  const mode: PaymentMode | 'UNKNOWN' = await getPublicConfig().then(
    (config) => config.paymentMode,
    () => 'UNKNOWN' as const,
  );

  // Live gateway or pay-at-counter (ADR-003): nothing is simulated, so no banner.
  if (mode === PaymentMode.LIVE || mode === PaymentMode.COUNTER) return null;

  if (mode === PaymentMode.DEMO) {
    return (
      <div
        role="status"
        data-testid="demo-banner"
        className="border-t border-separator bg-notice px-4 py-1.5 text-center text-[12px] font-semibold tracking-wide text-notice-text"
      >
        <span className="mr-2 rounded-full bg-notice-text/15 px-2 py-0.5 text-[10px]">DEMO</span>
        {DEMO_PAYMENT_BANNER}
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-testid="api-unreachable-banner"
      className="border-t border-separator bg-red/10 px-4 py-1.5 text-center text-[12px] font-semibold text-red"
    >
      Can&apos;t reach the Kagaz service right now. Ordering is unavailable.
    </div>
  );
}
