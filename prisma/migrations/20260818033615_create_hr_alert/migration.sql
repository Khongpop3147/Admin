-- CreateTable
CREATE TABLE "HrAlert" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientIds" TEXT[],
    "seenByIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "HrAlert_pkey" PRIMARY KEY ("id")
);
