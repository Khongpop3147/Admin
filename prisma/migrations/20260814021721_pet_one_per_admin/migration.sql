-- DropIndex
DROP INDEX "Pet_userId_species_key";

-- AlterTable
ALTER TABLE "Pet" ALTER COLUMN "species" SET DEFAULT 'PIG';

-- CreateIndex
CREATE UNIQUE INDEX "Pet_userId_key" ON "Pet"("userId");
