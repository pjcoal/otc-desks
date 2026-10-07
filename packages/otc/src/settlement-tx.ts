/**
 * OTC settlement transaction: builder, strict decoder and verifier. Isomorphic — the browser runs
 * the same verifier before asking the wallet to sign, so a compromised backend cannot slip in an
 * extra instruction, a different recipient, or a different amount.
 *
 * Instruction layout (exact order, see docs/otc-protocol.md §8):
 *   0  ComputeBudget.SetComputeUnitLimit
 *  [1] ComputeBudget.SetComputeUnitPrice           (only when price > 0)
 *   2  ATA.CreateIdempotent(payer=buyer, owner=buyer, mint, tokenProgram)
 *   3  Memo "otc-settlement:v1:<orderHash>:<settlementId>"   (no signers)
 *   4  Token.TransferChecked | Token2022.TransferCheckedWithFee  seller ATA → buyer ATA, authority seller
 *   5  System.Transfer buyer → seller     (sellerReceives, when > 0)
 *  [6] System.Transfer buyer → treasury   (platformFee, when > 0)
 *  [7] System.Transfer buyer → referrer   (referralFee, when > 0)
 * Fee payer = buyer (signature #0, also the transaction id). Signer #1 = seller. No lookup tables.
 */
import { Buffer } from "buffer";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  createTransferCheckedWithFeeInstruction,
  decodeTransferCheckedInstruction,
  decodeTransferCheckedWithFeeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  MessageV0,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionInstruction,
  VersionedMessage,
} from "@solana/web3.js";
import { compileV0, sha256Hex, type BuiltMessage } from "@app/solana";

export const SETTLEMENT_TX_VERSION = 1 as const;

/**
 * Canonical SPL Memo v2. Deliberately NOT `@solana/spl-memo@0.3.x`'s new default (Memo4c2p…), which
 * is an upgradeable program: this one is owned by the non-upgradeable BPFLoader2 (immutable) and is
 * the memo program Token-2022's MemoTransfer extension and explorers recognise. Verified on
 * devnet and mainnet-beta on 2026-10-07.
 */
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export function createMemoInstruction(memo: string): TransactionInstruction {
  return new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(memo, "utf8") });
}

export interface SettlementTerms {
  settlementId: string;
  orderHash: string;
  seller: string;
  buyer: string;
  tokenMint: string;
  tokenProgram: string;
  tokenDecimals: number;
  tokenAmountRaw: bigint;
  /** null ⇒ plain transferChecked. Otherwise transferCheckedWithFee asserting exactly this fee. */
  transferFeeRaw: bigint | null;
  sellerReceivesLamports: bigint;
  platformFeeLamports: bigint;
  treasuryWallet: string | null;
  referralFeeLamports: bigint;
  referrerWallet: string | null;
  computeUnitLimit: number;
  computeUnitPriceMicroLamports: number;
}

export function settlementMemo(orderHash: string, settlementId: string): string {
  return `otc-settlement:v${SETTLEMENT_TX_VERSION}:${orderHash}:${settlementId}`;
}

const ALLOWED_PROGRAMS = new Set([
  ComputeBudgetProgram.programId.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  MEMO_PROGRAM_ID.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  SystemProgram.programId.toBase58(),
]);

export class SettlementVerificationError extends Error {
  override name = "SettlementVerificationError";
  constructor(readonly problems: string[]) {
    super(`Settlement transaction rejected: ${problems.join("; ")}`);
  }
}

function pk(s: string): PublicKey {
  return new PublicKey(s);
}

export function buildSettlementInstructions(t: SettlementTerms): TransactionInstruction[] {
  const program = pk(t.tokenProgram);
  if (!program.equals(TOKEN_PROGRAM_ID) && !program.equals(TOKEN_2022_PROGRAM_ID)) throw new Error("unsupported token program");
  if (t.transferFeeRaw !== null && !program.equals(TOKEN_2022_PROGRAM_ID)) throw new Error("transfer fees require Token-2022");
  if (t.seller === t.buyer) throw new Error("seller and buyer must differ");
  if (t.tokenAmountRaw <= 0n) throw new Error("token amount must be positive");
  if (t.platformFeeLamports > 0n && !t.treasuryWallet) throw new Error("treasury wallet required for a platform fee");
  if (t.referralFeeLamports > 0n && !t.referrerWallet) throw new Error("referrer wallet required for a referral fee");

  const seller = pk(t.seller);
  const buyer = pk(t.buyer);
  const mint = pk(t.tokenMint);
  const sellerAta = getAssociatedTokenAddressSync(mint, seller, false, program);
  const buyerAta = getAssociatedTokenAddressSync(mint, buyer, false, program);

  const ixs: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: t.computeUnitLimit })];
  if (t.computeUnitPriceMicroLamports > 0) ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: t.computeUnitPriceMicroLamports }));
  ixs.push(createAssociatedTokenAccountIdempotentInstruction(buyer, buyerAta, buyer, mint, program));
  ixs.push(createMemoInstruction(settlementMemo(t.orderHash, t.settlementId)));
  ixs.push(
    t.transferFeeRaw === null
      ? createTransferCheckedInstruction(sellerAta, mint, buyerAta, seller, t.tokenAmountRaw, t.tokenDecimals, [], program)
      : createTransferCheckedWithFeeInstruction(sellerAta, mint, buyerAta, seller, t.tokenAmountRaw, t.tokenDecimals, t.transferFeeRaw, [], program),
  );
  if (t.sellerReceivesLamports > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: buyer, toPubkey: seller, lamports: t.sellerReceivesLamports }));
  if (t.platformFeeLamports > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: buyer, toPubkey: pk(t.treasuryWallet!), lamports: t.platformFeeLamports }));
  if (t.referralFeeLamports > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: buyer, toPubkey: pk(t.referrerWallet!), lamports: t.referralFeeLamports }));
  return ixs;
}

export function compileSettlementMessage(t: SettlementTerms, blockhash: string, lastValidBlockHeight: number): BuiltMessage {
  return compileV0(pk(t.buyer), buildSettlementInstructions(t), blockhash, lastValidBlockHeight);
}

export interface DecodedSettlement {
  messageHash: string;
  feePayer: string;
  signers: string[];
  blockhash: string;
  computeUnitLimit: number | null;
  computeUnitPriceMicroLamports: number;
  ataCreate: { payer: string; ata: string; owner: string; mint: string; tokenProgram: string } | null;
  memo: string | null;
  tokenTransfer: {
    program: string;
    source: string;
    mint: string;
    destination: string;
    authority: string;
    amount: bigint;
    decimals: number;
    fee: bigint | null;
  };
  solTransfers: Array<{ from: string; to: string; lamports: bigint }>;
}

/**
 * Strictly decode a settlement message WITHOUT reference to any claimed terms. Throws on anything
 * outside the allowlisted shape. Its output is what the UI shows as "you send / you receive".
 */
export function decodeSettlementMessage(bytes: Uint8Array): DecodedSettlement {
  const problems: string[] = [];
  const msg = VersionedMessage.deserialize(bytes);
  if (!(msg instanceof MessageV0) || msg.version !== 0) throw new SettlementVerificationError(["message must be a v0 message"]);
  if (msg.addressTableLookups.length > 0) throw new SettlementVerificationError(["address lookup tables are not allowed"]);
  if (msg.header.numRequiredSignatures !== 2) throw new SettlementVerificationError([`expected exactly 2 signers, found ${msg.header.numRequiredSignatures}`]);
  if (msg.header.numReadonlySignedAccounts !== 0) problems.push("both signers must be writable");

  const keys = msg.staticAccountKeys;
  const signers = keys.slice(0, 2).map((k) => k.toBase58());
  const feePayer = signers[0]!;
  const ixs = msg.compiledInstructions.map(
    (c) =>
      new TransactionInstruction({
        programId: keys[c.programIdIndex]!,
        keys: c.accountKeyIndexes.map((i) => ({ pubkey: keys[i]!, isSigner: msg.isAccountSigner(i), isWritable: msg.isAccountWritable(i) })),
        data: Buffer.from(c.data),
      }),
  );

  let computeUnitLimit: number | null = null;
  let computeUnitPriceMicroLamports = 0;
  let ataCreate: DecodedSettlement["ataCreate"] = null;
  let memo: string | null = null;
  let tokenTransfer: DecodedSettlement["tokenTransfer"] | null = null;
  const solTransfers: DecodedSettlement["solTransfers"] = [];

  for (const [i, ix] of ixs.entries()) {
    const program = ix.programId.toBase58();
    if (!ALLOWED_PROGRAMS.has(program)) {
      problems.push(`instruction ${i} calls a non-allowlisted program ${program}`);
      continue;
    }
    try {
      if (ix.programId.equals(ComputeBudgetProgram.programId)) {
        const type = ComputeBudgetInstruction.decodeInstructionType(ix);
        if (type === "SetComputeUnitLimit" && computeUnitLimit === null) computeUnitLimit = ComputeBudgetInstruction.decodeSetComputeUnitLimit(ix).units;
        else if (type === "SetComputeUnitPrice" && computeUnitPriceMicroLamports === 0) computeUnitPriceMicroLamports = Number(ComputeBudgetInstruction.decodeSetComputeUnitPrice(ix).microLamports);
        else problems.push(`instruction ${i}: unexpected compute budget instruction ${type}`);
      } else if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        if (ataCreate !== null) problems.push(`instruction ${i}: duplicate ATA instruction`);
        else if (ix.data.length !== 1 || ix.data[0] !== 1 || ix.keys.length !== 6) problems.push(`instruction ${i}: only CreateIdempotent is allowed`);
        else if (!ix.keys[4]!.pubkey.equals(SystemProgram.programId)) problems.push(`instruction ${i}: bad ATA system program`);
        else
          ataCreate = {
            payer: ix.keys[0]!.pubkey.toBase58(),
            ata: ix.keys[1]!.pubkey.toBase58(),
            owner: ix.keys[2]!.pubkey.toBase58(),
            mint: ix.keys[3]!.pubkey.toBase58(),
            tokenProgram: ix.keys[5]!.pubkey.toBase58(),
          };
      } else if (ix.programId.equals(MEMO_PROGRAM_ID)) {
        if (memo !== null) problems.push(`instruction ${i}: duplicate memo`);
        else if (ix.keys.length !== 0) problems.push(`instruction ${i}: memo must not require signers`);
        else memo = new TextDecoder("utf-8", { fatal: true }).decode(ix.data);
      } else if (ix.programId.equals(TOKEN_PROGRAM_ID) || ix.programId.equals(TOKEN_2022_PROGRAM_ID)) {
        if (tokenTransfer !== null) {
          problems.push(`instruction ${i}: more than one token instruction`);
        } else if (ix.data[0] === 12) {
          const d = decodeTransferCheckedInstruction(ix, ix.programId);
          if (d.keys.multiSigners.length > 0) problems.push(`instruction ${i}: multisig authorities are not allowed`);
          tokenTransfer = {
            program,
            source: d.keys.source.pubkey.toBase58(),
            mint: d.keys.mint.pubkey.toBase58(),
            destination: d.keys.destination.pubkey.toBase58(),
            authority: d.keys.owner.pubkey.toBase58(),
            amount: d.data.amount,
            decimals: d.data.decimals,
            fee: null,
          };
        } else if (ix.programId.equals(TOKEN_2022_PROGRAM_ID) && ix.data[0] === 26 && ix.data[1] === 1) {
          const d = decodeTransferCheckedWithFeeInstruction(ix, ix.programId);
          if (d.keys.signers && d.keys.signers.length > 0) problems.push(`instruction ${i}: multisig authorities are not allowed`);
          tokenTransfer = {
            program,
            source: d.keys.source.pubkey.toBase58(),
            mint: d.keys.mint.pubkey.toBase58(),
            destination: d.keys.destination.pubkey.toBase58(),
            authority: d.keys.authority.pubkey.toBase58(),
            amount: d.data.amount,
            decimals: d.data.decimals,
            fee: d.data.fee,
          };
        } else {
          problems.push(`instruction ${i}: only TransferChecked / TransferCheckedWithFee token instructions are allowed`);
        }
      } else if (ix.programId.equals(SystemProgram.programId)) {
        const type = SystemInstruction.decodeInstructionType(ix);
        if (type !== "Transfer") {
          problems.push(`instruction ${i}: only System Transfer is allowed (found ${type})`);
        } else {
          const d = SystemInstruction.decodeTransfer(ix);
          if (!d.fromPubkey.equals(new PublicKey(feePayer))) problems.push(`instruction ${i}: SOL may only be sent by the buyer`);
          solTransfers.push({ from: d.fromPubkey.toBase58(), to: d.toPubkey.toBase58(), lamports: BigInt(d.lamports.toString()) });
        }
      }
    } catch (e) {
      problems.push(`instruction ${i}: undecodable (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  if (!tokenTransfer) problems.push("missing token transfer");
  if (solTransfers.length > 3) problems.push("too many SOL transfers");
  if (problems.length > 0) throw new SettlementVerificationError(problems);

  return { messageHash: sha256Hex(bytes), feePayer, signers, blockhash: msg.recentBlockhash, computeUnitLimit, computeUnitPriceMicroLamports, ataCreate, memo, tokenTransfer: tokenTransfer!, solTransfers };
}

/**
 * Verify that `bytes` is EXACTLY the settlement for `terms`: decode strictly, then rebuild the
 * message from the terms (with the same blockhash) and require byte equality. Semantic checks run
 * first so failures produce precise messages.
 */
export function verifySettlementMessage(bytes: Uint8Array, t: SettlementTerms): DecodedSettlement {
  const d = decodeSettlementMessage(bytes);
  const problems: string[] = [];
  const program = pk(t.tokenProgram);
  const mint = pk(t.tokenMint);
  const sellerAta = getAssociatedTokenAddressSync(mint, pk(t.seller), false, program).toBase58();
  const buyerAta = getAssociatedTokenAddressSync(mint, pk(t.buyer), false, program).toBase58();

  if (d.feePayer !== t.buyer) problems.push("fee payer is not the buyer");
  if (d.signers[1] !== t.seller) problems.push("second signer is not the seller");
  if (d.tokenTransfer.mint !== t.tokenMint) problems.push("token mint differs");
  if (d.tokenTransfer.program !== t.tokenProgram) problems.push("token program differs");
  if (d.tokenTransfer.amount !== t.tokenAmountRaw) problems.push("token amount differs");
  if (d.tokenTransfer.decimals !== t.tokenDecimals) problems.push("token decimals differ");
  if (d.tokenTransfer.source !== sellerAta) problems.push("token source is not the seller's associated account");
  if (d.tokenTransfer.destination !== buyerAta) problems.push("token destination is not the buyer's associated account");
  if (d.tokenTransfer.authority !== t.seller) problems.push("token authority is not the seller");
  if ((d.tokenTransfer.fee ?? null) !== t.transferFeeRaw) problems.push("token transfer fee differs");
  if (d.memo !== settlementMemo(t.orderHash, t.settlementId)) problems.push("memo does not bind this order");
  const toSeller = d.solTransfers.filter((s) => s.to === t.seller).reduce((a, s) => a + s.lamports, 0n);
  if (toSeller !== t.sellerReceivesLamports) problems.push("SOL paid to seller differs");
  const toTreasury = t.treasuryWallet ? d.solTransfers.filter((s) => s.to === t.treasuryWallet).reduce((a, s) => a + s.lamports, 0n) : 0n;
  if (toTreasury !== t.platformFeeLamports) problems.push("platform fee differs");
  const toReferrer = t.referrerWallet ? d.solTransfers.filter((s) => s.to === t.referrerWallet).reduce((a, s) => a + s.lamports, 0n) : 0n;
  if (toReferrer !== t.referralFeeLamports) problems.push("referral fee differs");
  const known = new Set([t.seller, t.treasuryWallet, t.referrerWallet].filter(Boolean));
  for (const s of d.solTransfers) if (!known.has(s.to)) problems.push(`unexpected SOL recipient ${s.to}`);
  if (problems.length > 0) throw new SettlementVerificationError(problems);

  const expected = compileV0(pk(t.buyer), buildSettlementInstructions(t), d.blockhash, 0).bytes;
  if (expected.length !== bytes.length || expected.some((b, i) => b !== bytes[i])) {
    throw new SettlementVerificationError(["message bytes differ from the canonical settlement for these terms"]);
  }
  return d;
}

/** Plain-JSON form of SettlementTerms for APIs (bigints as strings). */
export type SettlementTermsJson = { [K in keyof SettlementTerms]: SettlementTerms[K] extends bigint ? string : SettlementTerms[K] extends bigint | null ? string | null : SettlementTerms[K] };

export function termsToJson(t: SettlementTerms): SettlementTermsJson {
  return {
    ...t,
    tokenAmountRaw: t.tokenAmountRaw.toString(),
    transferFeeRaw: t.transferFeeRaw === null ? null : t.transferFeeRaw.toString(),
    sellerReceivesLamports: t.sellerReceivesLamports.toString(),
    platformFeeLamports: t.platformFeeLamports.toString(),
    referralFeeLamports: t.referralFeeLamports.toString(),
  };
}

export function termsFromJson(j: SettlementTermsJson): SettlementTerms {
  return {
    ...j,
    tokenAmountRaw: BigInt(j.tokenAmountRaw),
    transferFeeRaw: j.transferFeeRaw === null ? null : BigInt(j.transferFeeRaw),
    sellerReceivesLamports: BigInt(j.sellerReceivesLamports),
    platformFeeLamports: BigInt(j.platformFeeLamports),
    referralFeeLamports: BigInt(j.referralFeeLamports),
  };
}
