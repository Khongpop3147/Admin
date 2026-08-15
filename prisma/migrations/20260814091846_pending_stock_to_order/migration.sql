-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "packingEntryDate" TEXT;

-- AlterTable
ALTER TABLE "PendingStock" ADD COLUMN     "orderId" TEXT;
