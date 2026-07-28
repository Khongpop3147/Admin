-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNo" INTEGER NOT NULL DEFAULT 0,
    "customerName" TEXT NOT NULL,
    "platform" TEXT,
    "socialMediaName" TEXT,
    "crispyPorkPiece" TEXT,
    "crispyPorkWeight" TEXT,
    "packedPork" TEXT,
    "promotion" TEXT,
    "price" DOUBLE PRECISION,
    "shippingMethod" TEXT,
    "additionalShippingCost" DOUBLE PRECISION,
    "codAmount" DOUBLE PRECISION,
    "actualReceivedAmount" DOUBLE PRECISION,
    "transferSlip" TEXT,
    "paymentStatus" TEXT,
    "customerAddress" TEXT,
    "orderStatus" TEXT,
    "rackDetails" TEXT,
    "sellerName" TEXT,
    "trackingNumber" TEXT,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCounter" (
    "date" TEXT NOT NULL,
    "lastOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyCounter_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "RackAssignment" (
    "id" TEXT NOT NULL,
    "rackNo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "initialWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remainingWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isUsedUp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RackAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletedPorkLog" (
    "id" TEXT NOT NULL,
    "rackNo" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "userName" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletedPorkLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RackAssignment_userId_rackNo_key" ON "RackAssignment"("userId", "rackNo");

-- AddForeignKey
ALTER TABLE "RackAssignment" ADD CONSTRAINT "RackAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

