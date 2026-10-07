-- CreateEnum
CREATE TYPE "NoncePurpose" AS ENUM ('SIGN_IN', 'OTC_ACTION');

-- CreateEnum
CREATE TYPE "MarketVenue" AS ENUM ('PUMP_BONDING_CURVE', 'PUMPSWAP', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EventProgram" AS ENUM ('PUMP', 'PUMP_AMM');

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('CREATE', 'TRADE', 'COMPLETE', 'MIGRATE', 'CREATE_POOL', 'AMM_BUY', 'AMM_SELL');

-- CreateEnum
CREATE TYPE "Commitment" AS ENUM ('CONFIRMED', 'FINALIZED');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "FeeMode" AS ENUM ('BUYER_PAYS', 'SELLER_PAYS', 'SPLIT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'OPEN', 'NEGOTIATING', 'ACCEPTED', 'SETTLEMENT_READY', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED', 'INVALIDATED', 'FAILED');

-- CreateEnum
CREATE TYPE "SignatureKind" AS ENUM ('ORDER', 'ACCEPT', 'CANCEL');

-- CreateEnum
CREATE TYPE "NegotiationStatus" AS ENUM ('OPEN', 'AGREED', 'SETTLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('AWAITING_BUYER_SIGNATURE', 'AWAITING_SELLER_SIGNATURE', 'READY_TO_SUBMIT', 'SUBMITTED', 'CONFIRMED', 'FINALIZED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TxKind" AS ENUM ('LAUNCH', 'BUY', 'SELL', 'OTC_SETTLEMENT');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PREPARED', 'SUBMITTED', 'CONFIRMED', 'FINALIZED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('OFFER_RECEIVED', 'BID_RECEIVED', 'COUNTEROFFER', 'OFFER_ACCEPTED', 'SIGNATURE_REQUIRED', 'TX_SUBMITTED', 'TRADE_CONFIRMED', 'ORDER_EXPIRED', 'ORDER_CANCELLED', 'SETTLEMENT_FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referralCode" TEXT NOT NULL,
    "displayName" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "address" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nonce" (
    "value" TEXT NOT NULL,
    "purpose" "NoncePurpose" NOT NULL,
    "walletAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "Nonce_pkey" PRIMARY KEY ("value")
);

-- CreateTable
CREATE TABLE "ReferralAttribution" (
    "wallet" TEXT NOT NULL,
    "referrerWallet" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralAttribution_pkey" PRIMARY KEY ("wallet")
);

-- CreateTable
CREATE TABLE "Token" (
    "mint" TEXT NOT NULL,
    "tokenProgram" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "imageUrl" TEXT,
    "creator" TEXT,
    "quoteMint" TEXT NOT NULL DEFAULT 'SOL',
    "isMayhemMode" BOOLEAN NOT NULL DEFAULT false,
    "isHolderReward" BOOLEAN NOT NULL DEFAULT false,
    "venue" "MarketVenue" NOT NULL DEFAULT 'UNKNOWN',
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "poolAddress" TEXT,
    "createSignature" TEXT,
    "createdSlot" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "graduatedAt" TIMESTAMP(3),
    "lastTradeAt" TIMESTAMP(3),
    "launchedViaPlatform" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("mint")
);

-- CreateTable
CREATE TABLE "TokenMetadata" (
    "mint" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "website" TEXT,
    "twitter" TEXT,
    "telegram" TEXT,
    "raw" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchError" TEXT,

    CONSTRAINT "TokenMetadata_pkey" PRIMARY KEY ("mint")
);

-- CreateTable
CREATE TABLE "MarketState" (
    "mint" TEXT NOT NULL,
    "venue" "MarketVenue" NOT NULL,
    "priceSolPerToken" DECIMAL(40,18) NOT NULL,
    "marketCapLamports" DECIMAL(40,0) NOT NULL,
    "liquidityLamports" DECIMAL(40,0) NOT NULL,
    "virtualSolReserves" DECIMAL(40,0),
    "virtualTokenReserves" DECIMAL(40,0),
    "realSolReserves" DECIMAL(40,0),
    "realTokenReserves" DECIMAL(40,0),
    "bondingProgressBps" INTEGER,
    "volume24hLamports" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "trades24h" INTEGER NOT NULL DEFAULT 0,
    "holderCount" INTEGER,
    "slot" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketState_pkey" PRIMARY KEY ("mint")
);

-- CreateTable
CREATE TABLE "PumpEvent" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "slot" BIGINT NOT NULL,
    "blockTime" TIMESTAMP(3),
    "program" "EventProgram" NOT NULL,
    "kind" "EventKind" NOT NULL,
    "mint" TEXT,
    "data" JSONB NOT NULL,
    "commitment" "Commitment" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PumpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "mint" TEXT NOT NULL,
    "venue" "MarketVenue" NOT NULL,
    "side" "TradeSide" NOT NULL,
    "trader" TEXT NOT NULL,
    "solAmount" DECIMAL(40,0) NOT NULL,
    "tokenAmount" DECIMAL(40,0) NOT NULL,
    "priceSolPerToken" DECIMAL(40,18) NOT NULL,
    "protocolFee" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "creatorFee" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "slot" BIGINT NOT NULL,
    "blockTime" TIMESTAMP(3) NOT NULL,
    "commitment" "Commitment" NOT NULL DEFAULT 'CONFIRMED',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCheckpoint" (
    "stream" TEXT NOT NULL,
    "lastSlot" BIGINT NOT NULL,
    "lastSignature" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCheckpoint_pkey" PRIMARY KEY ("stream")
);

-- CreateTable
CREATE TABLE "Launch" (
    "signature" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "creator" TEXT NOT NULL,
    "initialBuyLamports" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "initialBuyTokens" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "slot" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Launch_pkey" PRIMARY KEY ("signature")
);

-- CreateTable
CREATE TABLE "OtcOrder" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "orderHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "environment" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "genesisHash" TEXT NOT NULL,
    "makerWallet" TEXT NOT NULL,
    "takerWallet" TEXT,
    "tokenMint" TEXT NOT NULL,
    "tokenProgram" TEXT NOT NULL,
    "tokenDecimals" INTEGER NOT NULL,
    "side" "OrderSide" NOT NULL,
    "tokenAmountRaw" DECIMAL(40,0) NOT NULL,
    "quoteMint" TEXT NOT NULL,
    "quoteAmountRaw" DECIMAL(40,0) NOT NULL,
    "priceDecimal" DECIMAL(40,18) NOT NULL,
    "allowPartialFill" BOOLEAN NOT NULL,
    "minimumFillAmountRaw" DECIMAL(40,0) NOT NULL,
    "filledAmountRaw" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "platformFeeBps" INTEGER NOT NULL,
    "feeMode" "FeeMode" NOT NULL,
    "metadataVersion" INTEGER NOT NULL,
    "note" TEXT,
    "nonce" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "statusReason" TEXT,
    "signedMessage" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "filledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parentOrderId" TEXT,
    "rootOrderId" TEXT NOT NULL,
    "rootNegotiationId" TEXT,
    "revision" INTEGER NOT NULL,
    "refPriceSolPerToken" DECIMAL(40,18),
    "refPriceAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OtcOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtcOrderSignature" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "SignatureKind" NOT NULL,
    "signer" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "fillAmountRaw" DECIMAL(40,0),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtcOrderSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtcNegotiation" (
    "id" TEXT NOT NULL,
    "rootOrderId" TEXT NOT NULL,
    "makerWallet" TEXT NOT NULL,
    "counterpartyWallet" TEXT NOT NULL,
    "status" "NegotiationStatus" NOT NULL DEFAULT 'OPEN',
    "latestRevision" INTEGER NOT NULL DEFAULT 0,
    "latestOrderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtcNegotiation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtcSettlement" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "activeLock" TEXT,
    "attempt" INTEGER NOT NULL,
    "acceptanceSignatureId" TEXT NOT NULL,
    "sellerWallet" TEXT NOT NULL,
    "buyerWallet" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "tokenProgram" TEXT NOT NULL,
    "tokenDecimals" INTEGER NOT NULL,
    "tokenAmountRaw" DECIMAL(40,0) NOT NULL,
    "grossQuoteLamports" DECIMAL(40,0) NOT NULL,
    "buyerPaysLamports" DECIMAL(40,0) NOT NULL,
    "sellerReceivesLamports" DECIMAL(40,0) NOT NULL,
    "platformFeeLamports" DECIMAL(40,0) NOT NULL,
    "referralFeeLamports" DECIMAL(40,0) NOT NULL,
    "referrerWallet" TEXT,
    "treasuryWallet" TEXT,
    "transferFeeRaw" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "netTokenReceivedRaw" DECIMAL(40,0) NOT NULL,
    "messageBytes" BYTEA NOT NULL,
    "messageHash" TEXT NOT NULL,
    "blockhash" TEXT NOT NULL,
    "lastValidBlockHeight" BIGINT NOT NULL,
    "buyerSignature" TEXT,
    "sellerSignature" TEXT,
    "txSignature" TEXT,
    "status" "SettlementStatus" NOT NULL,
    "failureReason" TEXT,
    "slot" BIGINT,
    "blockTime" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "refPriceSolPerToken" DECIMAL(40,18),
    "refPriceAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtcSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformFee" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "amountLamports" DECIMAL(40,0) NOT NULL,
    "treasuryWallet" TEXT NOT NULL,
    "txSignature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralPayout" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "referrerWallet" TEXT NOT NULL,
    "amountLamports" DECIMAL(40,0) NOT NULL,
    "txSignature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionRecord" (
    "signature" TEXT NOT NULL,
    "kind" "TxKind" NOT NULL,
    "wallet" TEXT NOT NULL,
    "mint" TEXT,
    "status" "TxStatus" NOT NULL,
    "slot" BIGINT,
    "blockTime" TIMESTAMP(3),
    "error" TEXT,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionRecord_pkey" PRIMARY KEY ("signature")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "orderId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "data" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "code" TEXT,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_walletAddress_idx" ON "Session"("walletAddress");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Nonce_expiresAt_idx" ON "Nonce"("expiresAt");

-- CreateIndex
CREATE INDEX "ReferralAttribution_referrerWallet_idx" ON "ReferralAttribution"("referrerWallet");

-- CreateIndex
CREATE INDEX "Token_creator_idx" ON "Token"("creator");

-- CreateIndex
CREATE INDEX "Token_createdAt_idx" ON "Token"("createdAt");

-- CreateIndex
CREATE INDEX "Token_venue_complete_idx" ON "Token"("venue", "complete");

-- CreateIndex
CREATE INDEX "Token_lastTradeAt_idx" ON "Token"("lastTradeAt");

-- CreateIndex
CREATE INDEX "Token_symbol_idx" ON "Token"("symbol");

-- CreateIndex
CREATE INDEX "Token_isDemo_idx" ON "Token"("isDemo");

-- CreateIndex
CREATE INDEX "MarketState_marketCapLamports_idx" ON "MarketState"("marketCapLamports");

-- CreateIndex
CREATE INDEX "MarketState_volume24hLamports_idx" ON "MarketState"("volume24hLamports");

-- CreateIndex
CREATE INDEX "MarketState_bondingProgressBps_idx" ON "MarketState"("bondingProgressBps");

-- CreateIndex
CREATE INDEX "PumpEvent_mint_slot_idx" ON "PumpEvent"("mint", "slot");

-- CreateIndex
CREATE INDEX "PumpEvent_commitment_slot_idx" ON "PumpEvent"("commitment", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "PumpEvent_signature_eventIndex_key" ON "PumpEvent"("signature", "eventIndex");

-- CreateIndex
CREATE INDEX "Trade_mint_blockTime_idx" ON "Trade"("mint", "blockTime");

-- CreateIndex
CREATE INDEX "Trade_trader_blockTime_idx" ON "Trade"("trader", "blockTime");

-- CreateIndex
CREATE INDEX "Trade_blockTime_idx" ON "Trade"("blockTime");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_signature_eventIndex_key" ON "Trade"("signature", "eventIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Launch_mint_key" ON "Launch"("mint");

-- CreateIndex
CREATE INDEX "Launch_creator_idx" ON "Launch"("creator");

-- CreateIndex
CREATE UNIQUE INDEX "OtcOrder_publicId_key" ON "OtcOrder"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "OtcOrder_orderHash_key" ON "OtcOrder"("orderHash");

-- CreateIndex
CREATE UNIQUE INDEX "OtcOrder_signature_key" ON "OtcOrder"("signature");

-- CreateIndex
CREATE INDEX "OtcOrder_tokenMint_status_side_idx" ON "OtcOrder"("tokenMint", "status", "side");

-- CreateIndex
CREATE INDEX "OtcOrder_makerWallet_status_idx" ON "OtcOrder"("makerWallet", "status");

-- CreateIndex
CREATE INDEX "OtcOrder_takerWallet_status_idx" ON "OtcOrder"("takerWallet", "status");

-- CreateIndex
CREATE INDEX "OtcOrder_status_expiresAt_idx" ON "OtcOrder"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "OtcOrder_rootOrderId_idx" ON "OtcOrder"("rootOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "OtcOrder_makerWallet_nonce_key" ON "OtcOrder"("makerWallet", "nonce");

-- CreateIndex
CREATE UNIQUE INDEX "OtcOrderSignature_signature_key" ON "OtcOrderSignature"("signature");

-- CreateIndex
CREATE INDEX "OtcOrderSignature_orderId_kind_idx" ON "OtcOrderSignature"("orderId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "OtcOrderSignature_signer_kind_nonce_key" ON "OtcOrderSignature"("signer", "kind", "nonce");

-- CreateIndex
CREATE INDEX "OtcNegotiation_makerWallet_idx" ON "OtcNegotiation"("makerWallet");

-- CreateIndex
CREATE INDEX "OtcNegotiation_counterpartyWallet_idx" ON "OtcNegotiation"("counterpartyWallet");

-- CreateIndex
CREATE UNIQUE INDEX "OtcNegotiation_rootOrderId_counterpartyWallet_key" ON "OtcNegotiation"("rootOrderId", "counterpartyWallet");

-- CreateIndex
CREATE UNIQUE INDEX "OtcSettlement_activeLock_key" ON "OtcSettlement"("activeLock");

-- CreateIndex
CREATE UNIQUE INDEX "OtcSettlement_messageHash_key" ON "OtcSettlement"("messageHash");

-- CreateIndex
CREATE UNIQUE INDEX "OtcSettlement_txSignature_key" ON "OtcSettlement"("txSignature");

-- CreateIndex
CREATE INDEX "OtcSettlement_orderId_idx" ON "OtcSettlement"("orderId");

-- CreateIndex
CREATE INDEX "OtcSettlement_status_createdAt_idx" ON "OtcSettlement"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OtcSettlement_sellerWallet_idx" ON "OtcSettlement"("sellerWallet");

-- CreateIndex
CREATE INDEX "OtcSettlement_buyerWallet_idx" ON "OtcSettlement"("buyerWallet");

-- CreateIndex
CREATE INDEX "OtcSettlement_tokenMint_status_idx" ON "OtcSettlement"("tokenMint", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformFee_settlementId_key" ON "PlatformFee"("settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralPayout_settlementId_key" ON "ReferralPayout"("settlementId");

-- CreateIndex
CREATE INDEX "ReferralPayout_referrerWallet_idx" ON "ReferralPayout"("referrerWallet");

-- CreateIndex
CREATE INDEX "TransactionRecord_wallet_createdAt_idx" ON "TransactionRecord"("wallet", "createdAt");

-- CreateIndex
CREATE INDEX "TransactionRecord_status_idx" ON "TransactionRecord"("status");

-- CreateIndex
CREATE INDEX "Notification_wallet_readAt_createdAt_idx" ON "Notification"("wallet", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_createdAt_idx" ON "AuditEvent"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actor_createdAt_idx" ON "AuditEvent"("actor", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenMetadata" ADD CONSTRAINT "TokenMetadata_mint_fkey" FOREIGN KEY ("mint") REFERENCES "Token"("mint") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketState" ADD CONSTRAINT "MarketState_mint_fkey" FOREIGN KEY ("mint") REFERENCES "Token"("mint") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtcOrder" ADD CONSTRAINT "OtcOrder_parentOrderId_fkey" FOREIGN KEY ("parentOrderId") REFERENCES "OtcOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtcOrder" ADD CONSTRAINT "OtcOrder_rootNegotiationId_fkey" FOREIGN KEY ("rootNegotiationId") REFERENCES "OtcNegotiation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtcOrderSignature" ADD CONSTRAINT "OtcOrderSignature_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OtcOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtcSettlement" ADD CONSTRAINT "OtcSettlement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OtcOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformFee" ADD CONSTRAINT "PlatformFee_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "OtcSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "OtcSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
