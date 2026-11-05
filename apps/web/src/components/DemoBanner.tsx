import { DEMO_PAYMENT_BANNER, PaymentMode } from '@kagaz/shared';
import { getPublicConfig } from '@/lib/api';

/**
 * Persistent banner driven by GET /api/config (PRD FR-CUST-09).
 * While payments are simulated it is always shown; it cannot be dismissed.
 * If the API is unreachable we cannot prove payments are live, so we say so instead.
 */
export async function DemoBanner() {
  const mode: PaymentMode | 'UNKNOWN' = await getPublicConfig().then(
    (config) => config.paymentMode,
    () => 'UNKNOWN' as const,
  );

  if (mode === PaymentMode.LIVE) return null;

  if (mode === PaymentMode.DEMO) {
    return (
      <div
        role="status"
        data-testid="demo-banner"
        className="sticky top-0 z-50 border-b border-demo/30 bg-demo-bg px-4 py-2 text-center text-sm font-semibold tracking-wide text-demo"
      >
        {DEMO_PAYMENT_BANNER}
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-testid="api-unreachable-banner"
      className="sticky top-0 z-50 border-b border-red-300 bg-red-50 px-4 py-2 text-center text-sm font-semibold text-red-700"
    >
      Cannot reach the Kagaz service right now. Ordering is unavailable.
    </div>
  );
}
