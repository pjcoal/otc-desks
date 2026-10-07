/**
 * Test-only ChainGateway backed by LiteSVM: an in-process Solana runtime that executes the real
 * System, SPL Token, Token-2022, Associated Token Account and Memo programs. Settlement tests run
 * against genuine program semantics (balances, frozen accounts, signatures, blockhash expiry).
 */
import { address, getTransactionDecoder, type Address } from "@solana/kit";
import {
  ExtensionType,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createInitializeTransferFeeConfigInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedMessage, VersionedTransaction, type AccountInfo, type TransactionError, type TransactionInstruction, type VersionedTransactionResponse } from "@solana/web3.js";
import bs58 from "bs58";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { inspectMintAccount, inspectTokenAccountInfo, type SignatureState } from "@app/solana";
import type { ChainGateway } from "../server/chain";

const TX_FIELDLESS = "AccountInUse AccountLoadedTwice AccountNotFound ProgramAccountNotFound InsufficientFundsForFee InvalidAccountForFee AlreadyProcessed BlockhashNotFound CallChainTooDeep MissingSignatureForFee InvalidAccountIndex SignatureFailure InvalidProgramForExecution SanitizeFailure".split(" ");
const IX_FIELDLESS = "GenericError InvalidArgument InvalidInstructionData InvalidAccountData AccountDataTooSmall InsufficientFunds IncorrectProgramId MissingRequiredSignature AccountAlreadyInitialized UninitializedAccount UnbalancedInstruction ModifiedProgramId ExternalAccountLamportSpend ExternalAccountDataModified ReadonlyLamportChange ReadonlyDataModified DuplicateAccountIndex".split(" ");

const BLOCKHASH_LIFETIME = 150;

export class LiteSvmError extends Error {
  constructor(
    message: string,
    readonly transactionError: TransactionError,
    readonly logs: string[],
  ) {
    super(message);
  }
}

function toWeb3Error(f: FailedTransactionMetadata): TransactionError {
  // litesvm's error classes are not exported; inspect structurally.
  const e = f.err() as unknown;
  if (typeof e === "number") return (TX_FIELDLESS[e] ?? `TxError${e}`) as TransactionError;
  const obj = e as { index?: number; accountIndex?: number; err?: () => unknown };
  if (typeof obj.index === "number" && typeof obj.err === "function") {
    const inner = obj.err() as unknown;
    if (typeof inner === "number") return { InstructionError: [obj.index, IX_FIELDLESS[inner] ?? `Error${inner}`] };
    const code = (inner as { code?: number }).code;
    if (typeof code === "number") return { InstructionError: [obj.index, { Custom: code }] };
    return { InstructionError: [obj.index, String(inner)] };
  }
  if (typeof obj.accountIndex === "number") return { InsufficientFundsForRent: { account_index: obj.accountIndex } } as unknown as TransactionError;
  return String(e) as TransactionError;
}

interface Landed {
  bytes: Uint8Array;
  slot: number;
  logs: string[];
  pre: Map<string, bigint>;
  post: Map<string, bigint>;
}

export class LiteSvmGateway implements ChainGateway {
  readonly svm: LiteSVM;
  blockHeight = 1_000;
  private validUntil = new Map<string, number>();
  private landed = new Map<string, Landed>();
  private decoder = getTransactionDecoder();
  readonly payer = Keypair.generate();

  constructor() {
    this.svm = new LiteSVM();
    this.airdrop(this.payer.publicKey, 1_000_000_000_000n);
  }

  private addr(k: PublicKey | string): Address {
    return address(typeof k === "string" ? k : k.toBase58());
  }

  airdrop(to: PublicKey, lamports: bigint): void {
    this.svm.airdrop(this.addr(to), lamports as never);
  }

  balance(of: PublicKey | string): bigint {
    return BigInt(this.svm.getBalance(this.addr(of)) ?? 0n);
  }

  /** Advance the simulated block height; past a blockhash's lifetime the runtime forgets it. */
  advanceBlocks(n: number): void {
    this.blockHeight += n;
    this.svm.expireBlockhash();
  }

  private accountInfo(key: string): AccountInfo<Buffer> | null {
    const a = this.svm.getAccount(this.addr(key));
    if (!a.exists) return null;
    return { data: Buffer.from(a.data), executable: a.executable, lamports: Number(a.lamports), owner: new PublicKey(a.programAddress), rentEpoch: 0 };
  }

  async getMint(mint: string, opts: { allowFreezeAuthority: boolean }) {
    const info = this.accountInfo(mint);
    return info ? inspectMintAccount(new PublicKey(mint), info, { allowFreezeAuthority: opts.allowFreezeAuthority, epoch: 0n }) : null;
  }
  async getAccounts(addresses: string[]) {
    return addresses.map((a) => this.accountInfo(a));
  }
  async getRentExemptMinimum(space: number) {
    return BigInt(this.svm.minimumBalanceForRentExemption(BigInt(space)));
  }
  async getLatestBlockhash() {
    const blockhash = this.svm.latestBlockhash();
    if (!this.validUntil.has(blockhash)) this.validUntil.set(blockhash, this.blockHeight + BLOCKHASH_LIFETIME);
    return { blockhash, lastValidBlockHeight: this.validUntil.get(blockhash)! };
  }
  async getBlockHeight() {
    return this.blockHeight;
  }
  async simulate(tx: VersionedTransaction) {
    // Mirror RPC simulateTransaction({ sigVerify: false }): placeholder signatures, verification off.
    const copy = new VersionedTransaction(tx.message, tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).map(() => new Uint8Array(64).fill(1)));
    this.svm.withSigverify(false);
    let r;
    try {
      r = this.svm.simulateTransaction(this.decoder.decode(copy.serialize()) as never);
    } finally {
      this.svm.withSigverify(true);
    }
    if (r instanceof FailedTransactionMetadata) return { err: toWeb3Error(r), logs: r.meta().logs() };
    return { err: null, logs: r.meta().logs() };
  }

  private tokenBalances(tx: VersionedTransaction): Map<string, bigint> {
    const out = new Map<string, bigint>();
    for (const k of tx.message.staticAccountKeys) {
      const info = this.accountInfo(k.toBase58());
      if (info && (info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID)) && info.data.length >= 165) {
        try {
          out.set(k.toBase58(), inspectTokenAccountInfo(k, info).amount);
        } catch {
          // a mint, not a token account
        }
      }
    }
    return out;
  }

  async send(raw: Uint8Array) {
    const tx = VersionedTransaction.deserialize(raw);
    const lastValid = this.validUntil.get(tx.message.recentBlockhash);
    if (lastValid === undefined || this.blockHeight > lastValid) throw new LiteSvmError("Blockhash not found", "BlockhashNotFound", []);
    const sig = bs58.encode(tx.signatures[0]!);
    if (this.landed.has(sig)) throw new LiteSvmError("This transaction has already been processed", "AlreadyProcessed", []);
    if (tx.signatures.some((sg) => sg.every((b) => b === 0))) throw new LiteSvmError("Transaction is missing signatures", "SignatureFailure", []);
    const pre = this.tokenBalances(tx);
    const r = this.svm.sendTransaction(this.decoder.decode(raw) as never);
    if (r instanceof FailedTransactionMetadata) throw new LiteSvmError(`Transaction simulation failed: ${r.toString()}`, toWeb3Error(r), r.meta().logs());
    this.landed.set(sig, { bytes: raw, slot: this.blockHeight, logs: r.logs(), pre, post: this.tokenBalances(tx) });
    return sig;
  }
  async getSignatureState(signature: string): Promise<{ state: SignatureState; slot?: number }> {
    const l = this.landed.get(signature);
    return l ? { state: "confirmed", slot: l.slot } : { state: "not_found" };
  }
  async getTransaction(signature: string): Promise<VersionedTransactionResponse | null> {
    const l = this.landed.get(signature);
    if (!l) return null;
    const tx = VersionedTransaction.deserialize(l.bytes);
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    const bal = (m: Map<string, bigint>) =>
      [...m.entries()].map(([k, amount]) => ({ accountIndex: keys.indexOf(k), mint: "", uiTokenAmount: { amount: amount.toString(), decimals: 0, uiAmount: null, uiAmountString: "" } }));
    return {
      slot: l.slot,
      blockTime: Math.floor(Date.now() / 1000),
      transaction: { message: VersionedMessage.deserialize(tx.message.serialize()), signatures: tx.signatures.map((s) => bs58.encode(s)) },
      meta: { err: null, fee: 10_000, preBalances: [], postBalances: [], logMessages: l.logs, innerInstructions: [], preTokenBalances: bal(l.pre), postTokenBalances: bal(l.post), loadedAddresses: { writable: [], readonly: [] } },
      version: 0,
    } as unknown as VersionedTransactionResponse;
  }

  // ── fixtures ──

  /** Send a setup transaction signed by `signers` (the gateway payer pays fees). */
  exec(instructions: TransactionInstruction[], signers: Keypair[] = []): string {
    const blockhash = this.svm.latestBlockhash();
    const msg = new TransactionMessage({ payerKey: this.payer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([this.payer, ...signers]);
    const r = this.svm.sendTransaction(this.decoder.decode(tx.serialize()) as never);
    if (r instanceof FailedTransactionMetadata) throw new Error(`setup tx failed: ${r.toString()}\n${r.meta().logs().join("\n")}`);
    return bs58.encode(tx.signatures[0]!);
  }

  createMint(opts: { decimals?: number; token2022?: boolean; transferFeeBps?: number; freezeAuthority?: PublicKey | null } = {}): { mint: PublicKey; authority: Keypair; programId: PublicKey } {
    const mint = Keypair.generate();
    const authority = Keypair.generate();
    const programId = opts.token2022 === false ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
    const exts = opts.transferFeeBps ? [ExtensionType.TransferFeeConfig] : [];
    const space = programId.equals(TOKEN_PROGRAM_ID) ? MINT_SIZE : getMintLen(exts);
    const lamports = Number(this.svm.minimumBalanceForRentExemption(BigInt(space)));
    const ixs: TransactionInstruction[] = [SystemProgram.createAccount({ fromPubkey: this.payer.publicKey, newAccountPubkey: mint.publicKey, space, lamports, programId })];
    if (opts.transferFeeBps) ixs.push(createInitializeTransferFeeConfigInstruction(mint.publicKey, authority.publicKey, authority.publicKey, opts.transferFeeBps, 1_000_000_000_000n, programId));
    ixs.push(createInitializeMint2Instruction(mint.publicKey, opts.decimals ?? 6, authority.publicKey, opts.freezeAuthority ?? null, programId));
    this.exec(ixs, [mint]);
    return { mint: mint.publicKey, authority, programId };
  }

  mintTo(m: { mint: PublicKey; authority: Keypair; programId: PublicKey }, owner: PublicKey, amount: bigint): PublicKey {
    const ata = getAssociatedTokenAddressSync(m.mint, owner, false, m.programId);
    this.exec(
      [createAssociatedTokenAccountIdempotentInstruction(this.payer.publicKey, ata, owner, m.mint, m.programId), createMintToInstruction(m.mint, ata, m.authority.publicKey, amount, [], m.programId)],
      [m.authority],
    );
    return ata;
  }

  tokenBalance(m: { mint: PublicKey; programId: PublicKey }, owner: PublicKey): bigint {
    const ata = getAssociatedTokenAddressSync(m.mint, owner, false, m.programId);
    return inspectTokenAccountInfo(ata, this.accountInfo(ata.toBase58())).amount;
  }
}
