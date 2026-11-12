import { NearbyShops } from '@/components/NearbyShops';
import { ScanQrButton } from '@/components/ScanQr';
import { Notice } from '@/components/ui';
import { listShops } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const shops = await listShops().catch(() => null);

  return (
    <section>
      <h1 className="mac-title">Print it. Pick it up.</h1>
      <p className="mt-1.5 text-[15px] text-text-secondary">
        Pick a print shop near you, upload your PDF, and collect it with your pickup number.
      </p>

      {/* At the shop already? The poster on the counter has its QR code. */}
      <div className="mac-card mt-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">At a print shop?</div>
          <div className="text-[13px] text-text-secondary">
            Scan the QR code on the counter to order from that shop.
          </div>
        </div>
        <ScanQrButton variant="card" />
      </div>

      {shops === null ? (
        <Notice tone="red">Can’t load shops right now. Please try again in a moment.</Notice>
      ) : (
        <NearbyShops shops={shops} />
      )}
    </section>
  );
}
