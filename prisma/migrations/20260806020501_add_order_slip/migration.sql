-- CreateTable
CREATE TABLE "OrderSlip" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderSlip_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "OrderSlip" ADD CONSTRAINT "OrderSlip_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
