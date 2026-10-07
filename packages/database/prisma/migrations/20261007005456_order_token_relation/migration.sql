-- AddForeignKey
ALTER TABLE "OtcOrder" ADD CONSTRAINT "OtcOrder_tokenMint_fkey" FOREIGN KEY ("tokenMint") REFERENCES "Token"("mint") ON DELETE RESTRICT ON UPDATE CASCADE;
