import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NewOrderFlow } from '@/components/order/NewOrderFlow';
import { Notice } from '@/components/ui';
import { getPublicConfig, listShops } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ shop?: string }>;
}) {
  const { shop: shopId } = await searchParams;
  if (!shopId) redirect('/shops');

  const [shops, config] = await Promise.all([
    listShops().catch(() => null),
    getPublicConfig().catch(() => null),
  ]);
  const shop = shops?.find((s) => s.id === shopId);

  if (!shops || !config) {
    return <Notice tone="red">Can’t reach Kagaz right now. Please try again in a moment.</Notice>;
  }
  if (!shop || !shop.acceptingOrders) {
    return (
      <section>
        <h1 className="mac-title">Shop unavailable</h1>
        <Notice tone="orange">This shop isn’t taking orders right now.</Notice>
        <Link href="/shops" className="mac-button mt-5">
          Choose another shop
        </Link>
      </section>
    );
  }

  return <NewOrderFlow shop={shop} config={config} />;
}
