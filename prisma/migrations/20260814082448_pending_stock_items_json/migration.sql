-- AlterTable
ALTER TABLE "PendingStock" DROP COLUMN "productType",
DROP COLUMN "weightKg",
ADD COLUMN     "items" JSONB NOT NULL,
ADD COLUMN     "transferSlip" TEXT;
