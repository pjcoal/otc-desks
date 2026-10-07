-- AlterTable
ALTER TABLE "OtcOrder" ADD COLUMN     "acceptanceExpiresAt" TIMESTAMP(3),
ADD COLUMN     "activeAcceptanceId" TEXT;
