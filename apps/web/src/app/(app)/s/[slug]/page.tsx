import { notFound, redirect } from 'next/navigation';
import { listShops } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Target of the in-shop "scan to print" QR code (kaggaz.in/s/<slug>): start an order at that shop. */
export default async function ShopQrPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shops = await listShops().catch(() => null);
  if (!shops) redirect('/shops'); // API unreachable: /shops explains it
  const shop = shops.find((s) => s.slug === slug);
  if (!shop) notFound();
  redirect(`/order/new?shop=${shop.id}`);
}
