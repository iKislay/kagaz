/**
 * Demo data reset (P1.11): deletes every order of the DEMO shops (shops.is_demo = true) and
 * everything hanging off them — events, payments, refunds, print jobs, pickup codes, file rows
 * and their storage objects — so a rehearsal starts from an empty queue. Shops, pricing, staff,
 * paired devices and printers are kept. Non-demo shops are never touched.
 *
 *   pnpm demo:reset -- [--shop demo-shop-a] [--yes] [--keep-files]
 *
 * Refuses to run when APP_ENV=production. Without --yes it only prints what it would delete.
 */
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { cliArgs, loadRootEnv } from './lib/common.js';
import { dbName, openDb, refuseInProduction } from './lib/db.js';

loadRootEnv();
refuseInProduction('reset demo data');
const args = cliArgs({
  shop: { type: 'string' },
  yes: { type: 'boolean', default: false },
  'keep-files': { type: 'boolean', default: false },
});

async function deleteObjects(keys: string[]): Promise<number> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket || keys.length === 0) return 0;
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'auto',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
  });
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    deleted += chunk.length;
  }
  return deleted;
}

async function main(): Promise<void> {
  const db = openDb();
  try {
    const shops = await db.shop.findMany({
      where: { isDemo: true, ...(args.shop ? { slug: args.shop } : {}) },
      select: { id: true, slug: true, name: true },
    });
    if (shops.length === 0) {
      console.log(args.shop ? `No demo shop "${args.shop}".` : 'No demo shops found.');
      return;
    }
    const shopIds = shops.map((s) => s.id);
    const orders = await db.order.findMany({
      where: { shopId: { in: shopIds } },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    const files = await db.fileAsset.findMany({
      where: { orderId: { in: orderIds } },
      select: { objectKey: true },
    });

    console.log(`Database: ${dbName()} (APP_ENV=${process.env.APP_ENV ?? 'local'})`);
    console.log(`Demo shops: ${shops.map((s) => s.slug).join(', ')}`);
    console.log(`Orders to delete: ${orderIds.length} (${files.length} stored files)`);
    if (!args.yes) {
      console.log('Dry run — re-run with --yes to delete.');
      return;
    }

    await db.$transaction(async (tx) => {
      const where = { orderId: { in: orderIds } };
      // Printers point at their active job: release them first.
      await tx.printer.updateMany({
        where: { shopId: { in: shopIds } },
        data: { activeJobId: null, leaseUntil: null },
      });
      await tx.refund.deleteMany({ where: { payment: where } });
      await tx.payment.deleteMany({ where });
      await tx.printJob.deleteMany({ where });
      await tx.orderEvent.deleteMany({ where });
      await tx.fileAsset.deleteMany({ where });
      // Audit rows are append-only history and are kept (order_id has no FK).
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
      // ADR-002: the demo shops' daily pickup numbers start again at #1.
      await tx.pickupCounter.deleteMany({ where: { shopId: { in: shopIds } } });
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'demo.reset',
          metadata: { shops: shops.map((s) => s.slug), orders: orderIds.length },
        },
      });
    });
    const removed = args['keep-files'] ? 0 : await deleteObjects(files.map((f) => f.objectKey));
    console.log(`Deleted ${orderIds.length} orders and ${removed} storage objects.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
