import { Injectable } from '@nestjs/common';
import { type SudoAttentionKind, type SudoOverview } from '@kagaz/shared';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { istMonthBounds, monthlyRecurringPaise } from './billing.js';
import { SudoShopsService } from './sudo-shops.service.js';

const SOON_DAYS = 7;

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
});
const day = (iso: string) => dateFmt.format(new Date(iso));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Platform-wide numbers and the "needs attention" list for the /sudoadmin overview. */
@Injectable()
export class SudoOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shops: SudoShopsService,
  ) {}

  async overview(now = new Date()): Promise<SudoOverview> {
    const rows = await this.shops.list(); // also settles subscriptions that ended
    const live = rows.filter((s) => s.lifecycle === 'LIVE');
    const subs = rows.flatMap((s) => (s.subscription ? [s.subscription] : []));

    const thisMonth = istMonthBounds(now);
    const lastMonth = istMonthBounds(now, -1);
    const [collectedThis, collectedLast, recent] = await Promise.all([
      this.prisma.subscriptionPayment.aggregate({
        where: { paidAt: { gte: thisMonth.start, lt: thisMonth.end } },
        _sum: { amountPaise: true },
      }),
      this.prisma.subscriptionPayment.aggregate({
        where: { paidAt: { gte: lastMonth.start, lt: lastMonth.end } },
        _sum: { amountPaise: true },
      }),
      this.prisma.subscriptionPayment.findMany({ orderBy: { paidAt: 'desc' }, take: 8 }),
    ]);
    const names = new Map(rows.map((s) => [s.id, s.name]));

    const attention: SudoOverview['attention'] = [];
    const add = (shop: { id: string; name: string }, kind: SudoAttentionKind, detail: string) =>
      attention.push({ shopId: shop.id, shopName: shop.name, kind, detail });
    for (const s of rows) {
      if (s.lifecycle === 'ARCHIVED') continue;
      if (s.lifecycle === 'SUSPENDED') {
        add(s, 'SUSPENDED', s.suspendedReason ?? 'Suspended');
        continue;
      }
      const sub = s.subscription;
      if (!sub) {
        if (!s.isDemo) add(s, 'NO_SUBSCRIPTION', 'No subscription');
      } else if (sub.overdue) {
        const late = -sub.daysLeft;
        add(
          s,
          'OVERDUE',
          sub.status === 'TRIALING'
            ? `Trial ended ${day(sub.currentPeriodEnd)}`
            : late === 0
              ? 'Payment due today'
              : `Paid through ${day(sub.currentPeriodEnd)} · ${plural(late, 'day')} overdue`,
        );
      } else if (sub.status === 'PAST_DUE') {
        add(s, 'PAST_DUE', `Marked past due · covered until ${day(sub.currentPeriodEnd)}`);
      } else if (sub.daysLeft <= SOON_DAYS && !sub.cancelAtPeriodEnd) {
        add(
          s,
          sub.status === 'TRIALING' ? 'TRIAL_ENDING' : 'RENEWAL_DUE',
          `${sub.status === 'TRIALING' ? 'Trial ends' : 'Renewal due'} ${day(sub.currentPeriodEnd)} (${plural(sub.daysLeft, 'day')})`,
        );
      }
      if (s.devicesTotal === 0) add(s, 'NOT_PAIRED', 'No shop PC paired');
    }

    return {
      shops: {
        total: rows.length,
        live: live.length,
        suspended: rows.filter((s) => s.lifecycle === 'SUSPENDED').length,
        archived: rows.filter((s) => s.lifecycle === 'ARCHIVED').length,
        demo: rows.filter((s) => s.isDemo && s.lifecycle !== 'ARCHIVED').length,
      },
      subscriptions: {
        trialing: subs.filter((s) => s.status === 'TRIALING').length,
        active: subs.filter((s) => s.status === 'ACTIVE').length,
        pastDue: subs.filter((s) => s.status === 'PAST_DUE').length,
        overdue: subs.filter((s) => s.overdue).length,
        none: live.filter((s) => !s.subscription).length,
      },
      mrrPaise: monthlyRecurringPaise(subs),
      collectedThisMonthPaise: collectedThis._sum.amountPaise ?? 0,
      collectedLastMonthPaise: collectedLast._sum.amountPaise ?? 0,
      orders30d: rows.reduce((n, s) => n + s.orders30d, 0),
      gmv30dPaise: rows.reduce((n, s) => n + s.gmv30dPaise, 0),
      attention,
      recentPayments: recent.map((p) => ({
        id: p.id,
        shopId: p.shopId,
        shopName: names.get(p.shopId) ?? 'Deleted shop',
        amountPaise: p.amountPaise,
        method: p.method,
        paidAt: p.paidAt.toISOString(),
      })),
    };
  }
}
