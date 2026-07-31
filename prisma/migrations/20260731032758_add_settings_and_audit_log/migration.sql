-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "returnPenalty" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "codFlatFeeThreshold" DOUBLE PRECISION NOT NULL DEFAULT 2.29,
    "codFlatFee" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "codDivisor" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "codMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAuditLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAuditLog_pkey" PRIMARY KEY ("id")
);
