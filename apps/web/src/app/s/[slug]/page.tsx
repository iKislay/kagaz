import { redirect } from 'next/navigation';

/**
 * A shop's QR code points here (`/s/<slug>`): a short, printable link that opens a new order
 * at that shop. The order page resolves the slug and shows "Shop unavailable" when needed.
 */
export default async function ShopShortLink({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/order/new?shop=${encodeURIComponent(slug)}`);
}
