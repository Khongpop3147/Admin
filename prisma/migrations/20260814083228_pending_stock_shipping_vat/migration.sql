-- AlterTable
ALTER TABLE "PendingStock" ADD COLUMN     "actualReceivedAmount" DOUBLE PRECISION,
ADD COLUMN     "additionalShippingCost" DOUBLE PRECISION,
ADD COLUMN     "shippingMethod" TEXT;
