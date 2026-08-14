-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "porkLoinPricePerKg" DOUBLE PRECISION NOT NULL DEFAULT 350;

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productType" TEXT NOT NULL DEFAULT 'PORK',
    "weight" DOUBLE PRECISION NOT NULL,
    "pieceCount" INTEGER,
    "pricePerKg" DOUBLE PRECISION,
    "price" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
