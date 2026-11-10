-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "pickup_date" DATE,
ADD COLUMN     "pickup_number" INTEGER;

-- CreateTable
CREATE TABLE "pickup_counters" (
    "shop_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "last_number" INTEGER NOT NULL,

    CONSTRAINT "pickup_counters_pkey" PRIMARY KEY ("shop_id","business_date")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_shop_id_pickup_date_pickup_number_key" ON "orders"("shop_id", "pickup_date", "pickup_number");

-- AddForeignKey
ALTER TABLE "pickup_counters" ADD CONSTRAINT "pickup_counters_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

