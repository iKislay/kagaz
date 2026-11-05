import Link from 'next/link';
import { type ShopSummary, formatPaise } from '@kagaz/shared';
import { Chevron, Dot, Group, Notice } from '@/components/ui';
import { listShops } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const shops = await listShops().catch(() => null);

  return (
    <section>
      <h1 className="mac-title">Print it. Pick it up.</h1>
      <p className="mt-1.5 text-[15px] text-text-secondary">
        Choose a print shop in Mandya, upload your PDF, pay, and collect it with a pickup code.
      </p>

      {shops === null ? (
        <Notice tone="red">Can’t load shops right now. Please try again in a moment.</Notice>
      ) : (
        <Group
          title="Print shops"
          footer="Prices are per printed side. The shop prints only after you pay."
        >
          {shops.length === 0 && (
            <div className="px-4 py-6 text-center text-[14px] text-text-secondary">
              No shops yet.
            </div>
          )}
          {shops.map((shop) => (
            <ShopRow key={shop.id} shop={shop} />
          ))}
        </Group>
      )}
    </section>
  );
}

function ShopRow({ shop }: { shop: ShopSummary }) {
  const rates = shop.pricing
    ? [
        `B/W ${formatPaise(shop.pricing.monoRatePaise)}`,
        shop.capabilities.colour && `Colour ${formatPaise(shop.pricing.colourRatePaise)}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Prices not set';
  const extras = [shop.capabilities.duplex && 'Double-sided', shop.isDemo && 'Demo shop']
    .filter(Boolean)
    .join(' · ');

  const body = (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-accent/12 text-[17px] font-bold text-accent">
        {shop.name.replace(/^Kagaz Demo Shop /, '').charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{shop.name}</div>
        <div className="truncate text-[13px] text-text-secondary">{shop.address}</div>
        <div className="mt-0.5 truncate text-[12px] text-text-secondary">
          {rates}
          {extras && ` · ${extras}`}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-text-secondary">
          <Dot tone={shop.acceptingOrders ? 'green' : 'neutral'} />
          {shop.acceptingOrders ? 'Open' : 'Unavailable'}
        </span>
        {shop.acceptingOrders && <Chevron />}
      </div>
    </div>
  );

  return shop.acceptingOrders ? (
    <Link
      href={`/order/new?shop=${shop.id}`}
      className="block transition-colors hover:bg-selection/60 active:bg-selection"
    >
      {body}
    </Link>
  ) : (
    <div aria-disabled className="opacity-55">
      {body}
    </div>
  );
}
