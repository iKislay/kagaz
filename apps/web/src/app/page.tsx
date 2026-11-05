import Link from 'next/link';
import { Placeholder } from '@/components/Placeholder';

export default function HomePage() {
  return (
    <Placeholder title="Choose a print shop" stage="P1.6">
      <p className="mt-4 text-sm text-slate-600">
        Shop list with status, rates and capabilities will appear here.
      </p>
      <Link
        href="/order/new"
        className="mt-4 inline-block rounded-md bg-brand px-4 py-2 text-sm font-medium text-white"
      >
        Start an order
      </Link>
    </Placeholder>
  );
}
