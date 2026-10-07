-- AlterTable
ALTER TABLE "MarketState" ADD COLUMN     "volume24hUsd" DECIMAL(24,2),
ADD COLUMN     "volume24hUsdAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MarketState_volume24hUsd_idx" ON "MarketState"("volume24hUsd");
