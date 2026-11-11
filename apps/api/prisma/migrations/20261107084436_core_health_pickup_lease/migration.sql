-- AlterTable
ALTER TABLE "shop_devices" ADD COLUMN     "os" TEXT,
ADD COLUMN     "pickup_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pickup_lock_until" TIMESTAMP(3),
ADD COLUMN     "pickup_window_at" TIMESTAMP(3),
ADD COLUMN     "queue_depth" INTEGER,
ADD COLUMN     "uptime_seconds" INTEGER;

-- CreateIndex
CREATE INDEX "print_jobs_status_lease_until_idx" ON "print_jobs"("status", "lease_until");
