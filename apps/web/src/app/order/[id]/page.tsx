import { OrderTracker } from '@/components/order/OrderTracker';

export default async function OrderTrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderTracker orderId={id} />;
}
