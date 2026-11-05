import { Placeholder } from '@/components/Placeholder';

export default async function OrderTrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Placeholder
      title="Order status"
      subtitle="Live updates until your prints are ready."
      stage="P1.6"
    >
      <p className="mt-3 font-mono text-[13px] text-text-secondary">Order {id}</p>
    </Placeholder>
  );
}
