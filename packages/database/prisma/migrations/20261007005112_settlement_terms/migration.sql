/*
  Warnings:

  - Added the required column `terms` to the `OtcSettlement` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "OtcSettlement" ADD COLUMN     "terms" JSONB NOT NULL;
