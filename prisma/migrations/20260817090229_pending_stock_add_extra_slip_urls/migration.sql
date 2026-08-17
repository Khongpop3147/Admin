-- AlterTable
ALTER TABLE "PendingStock" ADD COLUMN     "extraSlipUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
