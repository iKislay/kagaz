-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentMethod" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'OTHER');

-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "suspended_at" TIMESTAMP(3),
ADD COLUMN     "suspended_reason" TEXT;

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_paise" INTEGER NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "max_printers" INTEGER,
    "max_monthly_orders" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_subscriptions" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "price_paise" INTEGER NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "trial_ends_at" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "method" "SubscriptionPaymentMethod" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- CreateIndex
CREATE INDEX "shop_subscriptions_shop_id_created_at_idx" ON "shop_subscriptions"("shop_id", "created_at");

-- CreateIndex
CREATE INDEX "shop_subscriptions_status_current_period_end_idx" ON "shop_subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE INDEX "subscription_payments_subscription_id_paid_at_idx" ON "subscription_payments"("subscription_id", "paid_at");

-- CreateIndex
CREATE INDEX "subscription_payments_shop_id_paid_at_idx" ON "subscription_payments"("shop_id", "paid_at");

-- AddForeignKey
ALTER TABLE "shop_subscriptions" ADD CONSTRAINT "shop_subscriptions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_subscriptions" ADD CONSTRAINT "shop_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "shop_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (not expressible in Prisma): at most one open subscription per shop.
CREATE UNIQUE INDEX "shop_subscriptions_one_open_per_shop"
    ON "shop_subscriptions"("shop_id")
    WHERE "status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE');

-- Money is integer paise and never negative.
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_price_nonneg" CHECK ("price_paise" >= 0);
ALTER TABLE "shop_subscriptions" ADD CONSTRAINT "shop_subscriptions_price_nonneg" CHECK ("price_paise" >= 0);
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_amount_pos" CHECK ("amount_paise" > 0);
