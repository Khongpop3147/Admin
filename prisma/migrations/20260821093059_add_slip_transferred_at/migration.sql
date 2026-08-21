-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "slipTransferredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PendingStock" ADD COLUMN     "slipTransferredAt" TIMESTAMP(3);

