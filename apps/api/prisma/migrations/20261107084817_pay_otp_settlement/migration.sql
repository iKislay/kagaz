-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "settlement_ref" TEXT;

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hmac" TEXT NOT NULL,
    "ip" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_challenges_phone_created_at_idx" ON "otp_challenges"("phone", "created_at");

-- CreateIndex
CREATE INDEX "otp_challenges_ip_created_at_idx" ON "otp_challenges"("ip", "created_at");
