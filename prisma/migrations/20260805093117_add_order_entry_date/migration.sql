-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "entryDate" TEXT;

-- Backfill existing rows from their real creation timestamp, converted to
-- Bangkok-local date, so pre-existing orders keep matching the day they were
-- actually entered under (same semantics the app used before this column
-- existed).
UPDATE "Order"
SET "entryDate" = to_char("createdAt" AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD')
WHERE "entryDate" IS NULL;

ALTER TABLE "Order" ALTER COLUMN "entryDate" SET NOT NULL;
