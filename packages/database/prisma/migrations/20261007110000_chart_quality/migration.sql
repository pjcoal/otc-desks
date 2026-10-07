-- AlterTable
ALTER TABLE "MarketState" ADD COLUMN     "liquidityUsd" DECIMAL(24,2),
ADD COLUMN     "liquiditySolLamports" DECIMAL(40,0),
ADD COLUMN     "liquidityMcapBps" INTEGER,
ADD COLUMN     "buys24h" INTEGER,
ADD COLUMN     "sells24h" INTEGER,
ADD COLUMN     "sellBuyBps" INTEGER,
ADD COLUMN     "priceChange24hBps" INTEGER;
