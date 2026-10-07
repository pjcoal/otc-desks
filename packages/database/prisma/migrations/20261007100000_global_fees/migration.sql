-- AlterTable
ALTER TABLE "MarketState" ADD COLUMN     "globalFeesLamports" DECIMAL(40,0),
ADD COLUMN     "globalFeesAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MarketState_globalFeesLamports_idx" ON "MarketState"("globalFeesLamports");
