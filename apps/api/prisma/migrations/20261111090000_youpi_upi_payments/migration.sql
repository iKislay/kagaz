-- CreateEnum
CREATE TYPE "PaymentReportStatus" AS ENUM ('OPEN', 'APPROVED', 'DECLINED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "checkout_url" TEXT;

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "is_manual" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "shop_payment_accounts" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "upi_id" TEXT NOT NULL,
    "payee_name" TEXT NOT NULL,
    "external_merchant_id" TEXT,
    "credentials_sealed" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reports" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "utr" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "status" "PaymentReportStatus" NOT NULL DEFAULT 'OPEN',
    "decline_reason" TEXT,
    "decline_note" TEXT,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_payment_accounts_shop_id_key" ON "shop_payment_accounts"("shop_id");

-- CreateIndex
CREATE INDEX "shop_payment_accounts_provider_external_merchant_id_idx" ON "shop_payment_accounts"("provider", "external_merchant_id");

-- CreateIndex
CREATE INDEX "payment_reports_shop_id_status_created_at_idx" ON "payment_reports"("shop_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "payment_reports_order_id_created_at_idx" ON "payment_reports"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "shop_payment_accounts" ADD CONSTRAINT "shop_payment_accounts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ADR-003 hand-written partial unique indexes (Prisma cannot express them).
-- One OPEN payment report per order.
CREATE UNIQUE INDEX "payment_reports_one_open_per_order"
  ON "payment_reports"("order_id") WHERE "status" = 'OPEN';
-- A UPI reference backs at most one non-declined report per shop (no reuse across orders).
CREATE UNIQUE INDEX "payment_reports_utr_per_shop"
  ON "payment_reports"("shop_id", "utr") WHERE "status" <> 'DECLINED';
