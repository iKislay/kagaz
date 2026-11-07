-- CreateTable
CREATE TABLE "operator_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "operator_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printer_uptime_daily" (
    "printer_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "observed_samples" INTEGER NOT NULL DEFAULT 0,
    "up_samples" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "printer_uptime_daily_pkey" PRIMARY KEY ("printer_id","day")
);

-- CreateIndex
CREATE INDEX "operator_sessions_device_id_idx" ON "operator_sessions"("device_id");

-- CreateIndex
CREATE INDEX "operator_sessions_user_id_idx" ON "operator_sessions"("user_id");

-- CreateIndex
CREATE INDEX "printer_uptime_daily_shop_id_day_idx" ON "printer_uptime_daily"("shop_id", "day");
