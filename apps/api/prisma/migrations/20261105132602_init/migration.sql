-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('CUSTOMER', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('OPEN', 'CLOSED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "ShopUserRole" AS ENUM ('OWNER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "PrinterStatus" AS ENUM ('UNKNOWN', 'READY', 'OFFLINE', 'PAPER_OUT', 'ERROR');

-- CreateEnum
CREATE TYPE "DuplexRule" AS ENUM ('SAME_AS_SIMPLEX', 'DISCOUNTED_SIDE_RATE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'AWAITING_PAYMENT', 'PENDING_REVIEW', 'QUEUED', 'PRINTING', 'NEEDS_OPERATOR_CHECK', 'READY_FOR_PICKUP', 'COLLECTED', 'REJECTED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('CUSTOMER', 'STAFF', 'DEVICE', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('ORIGINAL', 'PACKET');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING_UPLOAD', 'VALID', 'INVALID', 'DELETED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'FAILED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('PREPARING', 'READY', 'LEASED', 'SUBMITTED', 'SPOOLER_COMPLETE', 'FAILED', 'UNCERTAIN', 'CANCELLED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "password_hash" TEXT,
    "name" TEXT,
    "kind" "UserKind" NOT NULL DEFAULT 'CUSTOMER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contact_phone" TEXT,
    "status" "ShopStatus" NOT NULL DEFAULT 'CLOSED',
    "approval_mode" "ApprovalMode" NOT NULL DEFAULT 'MANUAL',
    "auto_paused" BOOLEAN NOT NULL DEFAULT false,
    "auto_limits" JSONB NOT NULL,
    "opening_hours" JSONB NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "gateway_account_id" TEXT,
    "settlement_config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_users" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ShopUserRole" NOT NULL,
    "permissions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_devices" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "app_version" TEXT,
    "last_heartbeat_at" TIMESTAMP(3),
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "shop_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_codes" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "used_by_device_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printers" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "device_id" UUID,
    "printer_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "colour_capable" BOOLEAN NOT NULL DEFAULT false,
    "duplex_capable" BOOLEAN NOT NULL DEFAULT false,
    "paper_sizes" TEXT[] DEFAULT ARRAY['A4']::TEXT[],
    "capabilities_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "PrinterStatus" NOT NULL DEFAULT 'UNKNOWN',
    "last_status_at" TIMESTAMP(3),
    "last_error" TEXT,
    "active_job_id" UUID,
    "lease_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_pricing" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "mono_rate_paise" INTEGER NOT NULL,
    "colour_rate_paise" INTEGER NOT NULL,
    "mono_duplex_rate_paise" INTEGER,
    "colour_duplex_rate_paise" INTEGER,
    "duplex_rule" "DuplexRule" NOT NULL DEFAULT 'SAME_AS_SIMPLEX',
    "minimum_charge_paise" INTEGER NOT NULL DEFAULT 0,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "public_ref" TEXT NOT NULL,
    "customer_id" UUID,
    "customer_phone" TEXT,
    "shop_id" UUID NOT NULL,
    "printer_id" UUID,
    "options" JSONB NOT NULL,
    "quote" JSONB,
    "price_snapshot" JSONB,
    "amount_paise" INTEGER,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "tracking_token_hash" TEXT NOT NULL,
    "rejection_code" TEXT,
    "rejection_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "queued_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "collected_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_assets" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" "FileKind" NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "object_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'application/pdf',
    "bytes" INTEGER,
    "page_count" INTEGER,
    "sha256" TEXT,
    "error" TEXT,
    "expires_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_order_id" TEXT,
    "provider_payment_id" TEXT,
    "amount_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "is_simulated" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "provider_refund_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "reason" TEXT,
    "is_simulated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signature_valid" BOOLEAN NOT NULL,
    "processed_at" TIMESTAMP(3),
    "raw_payload_hash" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_jobs" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "printer_id" UUID NOT NULL,
    "packet_file_id" UUID,
    "attempt" INTEGER NOT NULL,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'PREPARING',
    "spooler_job_id" INTEGER,
    "lease_until" TIMESTAMP(3),
    "leased_by_device_id" UUID,
    "checksum" TEXT,
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_codes" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "code_hmac" TEXT NOT NULL,
    "encrypted_display_value" TEXT,
    "expires_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "consumed_by_device_id" UUID,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" TEXT,
    "shop_id" UUID,
    "order_id" UUID,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("scope","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "shops_slug_key" ON "shops"("slug");

-- CreateIndex
CREATE INDEX "shop_users_user_id_idx" ON "shop_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_users_shop_id_user_id_key" ON "shop_users"("shop_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_devices_token_hash_key" ON "shop_devices"("token_hash");

-- CreateIndex
CREATE INDEX "shop_devices_shop_id_idx" ON "shop_devices"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_codes_code_hash_key" ON "enrollment_codes"("code_hash");

-- CreateIndex
CREATE INDEX "enrollment_codes_shop_id_idx" ON "enrollment_codes"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "printers_active_job_id_key" ON "printers"("active_job_id");

-- CreateIndex
CREATE INDEX "printers_device_id_idx" ON "printers"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "printers_shop_id_printer_name_key" ON "printers"("shop_id", "printer_name");

-- CreateIndex
CREATE INDEX "shop_pricing_shop_id_effective_from_idx" ON "shop_pricing"("shop_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "orders_public_ref_key" ON "orders"("public_ref");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tracking_token_hash_key" ON "orders"("tracking_token_hash");

-- CreateIndex
CREATE INDEX "orders_shop_id_status_idx" ON "orders"("shop_id", "status");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "file_assets_object_key_key" ON "file_assets"("object_key");

-- CreateIndex
CREATE INDEX "file_assets_order_id_kind_idx" ON "file_assets"("order_id", "kind");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_order_id_key" ON "payments"("provider", "provider_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_payment_id_key" ON "payments"("provider", "provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_provider_event_id_key" ON "webhook_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "print_jobs_printer_id_status_created_at_idx" ON "print_jobs"("printer_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "print_jobs_order_id_attempt_key" ON "print_jobs"("order_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "pickup_codes_order_id_key" ON "pickup_codes"("order_id");

-- CreateIndex
CREATE INDEX "pickup_codes_code_hmac_idx" ON "pickup_codes"("code_hmac");

-- CreateIndex
CREATE INDEX "audit_logs_shop_id_created_at_idx" ON "audit_logs"("shop_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_order_id_created_at_idx" ON "audit_logs"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- AddForeignKey
ALTER TABLE "shop_users" ADD CONSTRAINT "shop_users_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_users" ADD CONSTRAINT "shop_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_devices" ADD CONSTRAINT "shop_devices_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_codes" ADD CONSTRAINT "enrollment_codes_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printers" ADD CONSTRAINT "printers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printers" ADD CONSTRAINT "printers_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "shop_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_pricing" ADD CONSTRAINT "shop_pricing_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "printers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "printers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_packet_file_id_fkey" FOREIGN KEY ("packet_file_id") REFERENCES "file_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_codes" ADD CONSTRAINT "pickup_codes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (not expressible in Prisma schema):
-- At most one *active* print job per order (PRD §9.4 rule 2). Finished, failed,
-- uncertain, cancelled and superseded attempts are excluded so a reprint can create attempt+1.
CREATE UNIQUE INDEX "print_jobs_one_active_per_order"
  ON "print_jobs" ("order_id")
  WHERE "status" IN ('PREPARING', 'READY', 'LEASED', 'SUBMITTED');

-- Money and counters must never go negative.
ALTER TABLE "shop_pricing"
  ADD CONSTRAINT "shop_pricing_non_negative" CHECK (
    "mono_rate_paise" >= 0 AND "colour_rate_paise" >= 0
    AND COALESCE("mono_duplex_rate_paise", 0) >= 0
    AND COALESCE("colour_duplex_rate_paise", 0) >= 0
    AND "minimum_charge_paise" >= 0
  );
ALTER TABLE "orders" ADD CONSTRAINT "orders_amount_non_negative" CHECK ("amount_paise" IS NULL OR "amount_paise" >= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount_paise" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_positive" CHECK ("amount_paise" > 0);
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_attempt_positive" CHECK ("attempt" >= 1);
