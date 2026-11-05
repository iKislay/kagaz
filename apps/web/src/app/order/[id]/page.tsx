import { Placeholder } from '@/components/Placeholder';

export default async function OrderTrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Placeholder title="Order tracking" stage="P1.6">
      <p className="mt-4 font-mono text-sm text-slate-600">Order {id}</p>
    </Placeholder>
  );
}
