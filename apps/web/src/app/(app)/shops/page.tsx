import { Notice } from '@/components/ui';
import { ShopList } from '@/components/customer/ShopList';
import { listShops } from '@/lib/api';
import { eyebrow } from '@/components/SiteChrome';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const shops = await listShops().catch(() => null);

  return (
    <section>
      <p className={eyebrow}>Print shops in Mandya</p>
      <h1 className="mac-title mt-4">Print it. Pick it up.</h1>
      <p className="mt-3 max-w-[52ch] text-[16px] leading-relaxed text-text-secondary">
        Choose a shop, upload your file, pay the exact price and collect it with your pickup code.
      </p>

      {shops === null ? (
        <Notice tone="red">Can’t load shops right now. Please try again in a moment.</Notice>
      ) : (
        <ShopList shops={shops} />
      )}
    </section>
  );
}
