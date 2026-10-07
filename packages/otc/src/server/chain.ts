import { PublicKey, type VersionedTransaction, type AccountInfo, type Connection, type TransactionError, type VersionedTransactionResponse } from "@solana/web3.js";
import { inspectMintAccount, type MintInspection, type SignatureState } from "@app/solana";
import { getSignatureState } from "@app/solana";

/**
 * Everything settlement needs from the chain. Production: Web3ChainGateway over the uncached
 * (fresh) RPC connection. Tests: an in-process LiteSVM gateway executing real SPL/System programs.
 */
export interface ChainGateway {
  getMint(mint: string, opts: { allowFreezeAuthority: boolean }): Promise<MintInspection | null>;
  getAccounts(addresses: string[]): Promise<Array<AccountInfo<Buffer> | null>>;
  getRentExemptMinimum(space: number): Promise<bigint>;
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  getBlockHeight(): Promise<number>;
  simulate(tx: VersionedTransaction): Promise<{ err: TransactionError | null; logs: string[] | null; unitsConsumed?: number }>;
  send(raw: Uint8Array): Promise<string>;
  getSignatureState(signature: string): Promise<{ state: SignatureState; slot?: number; err?: unknown }>;
  getTransaction(signature: string): Promise<VersionedTransactionResponse | null>;
}

export class Web3ChainGateway implements ChainGateway {
  constructor(private readonly connection: Connection) {}

  async getMint(mint: string, opts: { allowFreezeAuthority: boolean }) {
    const key = new PublicKey(mint);
    const [info, epoch] = await Promise.all([this.connection.getAccountInfo(key, "confirmed"), this.connection.getEpochInfo("confirmed")]);
    if (!info) return null;
    return inspectMintAccount(key, info, { allowFreezeAuthority: opts.allowFreezeAuthority, epoch: BigInt(epoch.epoch) });
  }
  getAccounts(addresses: string[]) {
    return this.connection.getMultipleAccountsInfo(addresses.map((a) => new PublicKey(a)), "confirmed");
  }
  async getRentExemptMinimum(space: number) {
    return BigInt(await this.connection.getMinimumBalanceForRentExemption(space, "confirmed"));
  }
  getLatestBlockhash() {
    return this.connection.getLatestBlockhash("confirmed");
  }
  getBlockHeight() {
    return this.connection.getBlockHeight("confirmed");
  }
  async simulate(tx: VersionedTransaction) {
    const r = await this.connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" });
    return { err: r.value.err, logs: r.value.logs, ...(r.value.unitsConsumed !== undefined ? { unitsConsumed: r.value.unitsConsumed } : {}) };
  }
  send(raw: Uint8Array) {
    return this.connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 });
  }
  getSignatureState(signature: string) {
    return getSignatureState(this.connection, signature);
  }
  getTransaction(signature: string) {
    return this.connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  }
}
