-- AlterTable
ALTER TABLE "DeletedPorkLog" ADD COLUMN     "productType" TEXT NOT NULL DEFAULT 'PORK';

-- AlterTable
ALTER TABLE "RackAssignment" ADD COLUMN     "productType" TEXT NOT NULL DEFAULT 'PORK';
