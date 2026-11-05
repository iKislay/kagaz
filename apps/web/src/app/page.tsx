import Link from 'next/link';
import { Placeholder } from '@/components/Placeholder';

export default function HomePage() {
  return (
    <Placeholder
      title="Print it. Pick it up."
      subtitle="Choose a print shop in Mandya, upload your PDF and collect it with a pickup code."
      stage="P1.6"
    >
      <Link href="/order/new" className="mac-button mt-5">
        Start an order
      </Link>
    </Placeholder>
  );
}
