-- Retired by ADR-002 (daily pickup numbers); never written since.
-- DropForeignKey
ALTER TABLE "pickup_codes" DROP CONSTRAINT "pickup_codes_order_id_fkey";

-- DropTable
DROP TABLE "pickup_codes";
