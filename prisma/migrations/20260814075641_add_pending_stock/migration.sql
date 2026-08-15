-- CreateTable
CREATE TABLE "PendingStock" (
    "id" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingStock_pkey" PRIMARY KEY ("id")
);
