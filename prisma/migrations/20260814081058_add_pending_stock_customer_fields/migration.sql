-- AlterTable
ALTER TABLE "PendingStock" ADD COLUMN     "customerAddress" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "customerZip" TEXT,
ADD COLUMN     "needsTaxInvoice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "platform" TEXT,
ADD COLUMN     "socialMediaName" TEXT;
