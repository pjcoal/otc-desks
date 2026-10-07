import {
  ACCOUNT_SIZE,
  AccountLayout,
  AccountState,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  calculateEpochFee,
  getDefaultAccountState,
  getExtensionData,
  getExtensionTypes,
  getInterestBearingMintConfigState,
  getMemoTransfer,
  getMintCloseAuthority,
  getPausableConfig,
  getPermanentDelegate,
  getScaledUiAmountConfig,
  getTransferFeeConfig,
  getTransferHook,
  unpackAccount,
  unpackMint,
  type Mint,
} from "@solana/spl-token";
import { unpack as unpackTokenMetadata } from "@solana/spl-token-metadata";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";

export type TokenProgramKind = "spl-token" | "token-2022";

export interface TransferFeeInfo {
  epoch: bigint;
  basisPoints: number;
  maximumFee: bigint;
  /** A different fee scheduled for a later epoch, if any. */
  upcoming?: { epoch: bigint; basisPoints: number; maximumFee: bigint };
}

export interface OtcSafety {
  /** False when any blocker exists — the trade must be refused. */
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

export interface MintInspection {
  mint: string;
  programId: PublicKey;
  program: TokenProgramKind;
  decimals: number;
  supply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: string[];
  transferFee: TransferFeeInfo | null;
  transferHookProgram: string | null;
  permanentDelegate: string | null;
  onChainMetadata: { name: string; symbol: string; uri: string; updateAuthority: string | null } | null;
  safety: OtcSafety;
}

/** Mint extensions we understand and consider harmless for a plain wallet-to-wallet transfer. */
const HARMLESS_MINT_EXTENSIONS = new Set<ExtensionType>([
  ExtensionType.MetadataPointer,
  ExtensionType.TokenMetadata,
  ExtensionType.GroupPointer,
  ExtensionType.TokenGroup,
  ExtensionType.GroupMemberPointer,
  ExtensionType.TokenGroupMember,
  ExtensionType.PermissionedBurn,
]);

/** Extensions handled with explicit logic below (blocked, supported, or warned). */
const HANDLED_MINT_EXTENSIONS = new Set<ExtensionType>([
  ExtensionType.TransferFeeConfig,
  ExtensionType.MintCloseAuthority,
  ExtensionType.ConfidentialTransferMint,
  ExtensionType.DefaultAccountState,
  ExtensionType.NonTransferable,
  ExtensionType.InterestBearingConfig,
  ExtensionType.PermanentDelegate,
  ExtensionType.TransferHook,
  ExtensionType.ScaledUiAmountConfig,
  ExtensionType.PausableConfig,
]);

export function extensionName(t: ExtensionType): string {
  return ExtensionType[t] ?? `Unknown(${t})`;
}

export function programKind(programId: PublicKey): TokenProgramKind {
  if (programId.equals(TOKEN_PROGRAM_ID)) return "spl-token";
  if (programId.equals(TOKEN_2022_PROGRAM_ID)) return "token-2022";
  throw new Error(`Account is not owned by a token program: ${programId.toBase58()}`);
}

export interface InspectOptions {
  allowFreezeAuthority?: boolean;
  /** Current epoch, used to pick the active transfer fee. */
  epoch: bigint;
}

/**
 * Decode a mint account (classic or Token-2022) and evaluate whether a simple
 * transferChecked-based OTC settlement is safe. Fail closed: any extension we do not know is a blocker.
 */
export function inspectMintAccount(address: PublicKey, info: AccountInfo<Buffer>, opts: InspectOptions): MintInspection {
  const program = programKind(info.owner);
  const mint: Mint = unpackMint(address, info, info.owner);
  const blockers: string[] = [];
  const warnings: string[] = [];

  const types = program === "token-2022" ? getExtensionTypes(mint.tlvData) : [];
  let transferFee: TransferFeeInfo | null = null;
  let transferHookProgram: string | null = null;
  let permanentDelegate: string | null = null;
  let onChainMetadata: MintInspection["onChainMetadata"] = null;

  for (const t of types) {
    if (!HARMLESS_MINT_EXTENSIONS.has(t) && !HANDLED_MINT_EXTENSIONS.has(t)) {
      blockers.push(`Unrecognised Token-2022 extension ${extensionName(t)}; refusing to settle (fail-closed).`);
    }
  }

  if (types.includes(ExtensionType.TransferFeeConfig)) {
    const cfg = getTransferFeeConfig(mint);
    if (cfg) {
      const active = opts.epoch >= cfg.newerTransferFee.epoch ? cfg.newerTransferFee : cfg.olderTransferFee;
      transferFee = { epoch: active.epoch, basisPoints: active.transferFeeBasisPoints, maximumFee: active.maximumFee };
      if (cfg.newerTransferFee.epoch > opts.epoch) {
        transferFee.upcoming = {
          epoch: cfg.newerTransferFee.epoch,
          basisPoints: cfg.newerTransferFee.transferFeeBasisPoints,
          maximumFee: cfg.newerTransferFee.maximumFee,
        };
        warnings.push(`Transfer fee changes at epoch ${cfg.newerTransferFee.epoch}; settlement asserts the exact fee and fails if it changes.`);
      }
      if (active.transferFeeBasisPoints > 0) {
        warnings.push(`Token charges a ${active.transferFeeBasisPoints / 100}% transfer fee; the buyer receives the net amount shown.`);
      }
    }
  }
  if (types.includes(ExtensionType.TransferHook)) {
    const hook = getTransferHook(mint);
    if (hook && !hook.programId.equals(PublicKey.default)) {
      transferHookProgram = hook.programId.toBase58();
      blockers.push("Token uses a transfer hook: an external program runs on every transfer. Not supported for OTC settlement.");
    }
  }
  if (types.includes(ExtensionType.PermanentDelegate)) {
    const pd = getPermanentDelegate(mint);
    if (pd && !pd.delegate.equals(PublicKey.default)) {
      permanentDelegate = pd.delegate.toBase58();
      blockers.push("Token has a permanent delegate that can move tokens out of any holder's account at any time.");
    }
  }
  if (types.includes(ExtensionType.NonTransferable)) blockers.push("Token is non-transferable.");
  if (types.includes(ExtensionType.ConfidentialTransferMint)) {
    blockers.push("Token supports confidential transfers; balances cannot be verified for settlement.");
  }
  if (types.includes(ExtensionType.DefaultAccountState)) {
    const das = getDefaultAccountState(mint);
    if (das && das.state === AccountState.Frozen) blockers.push("New token accounts start frozen; the buyer could not receive tokens.");
  }
  if (types.includes(ExtensionType.InterestBearingConfig) && getInterestBearingMintConfigState(mint)) {
    blockers.push("Token is interest-bearing: displayed amounts differ from raw balances, which would make OTC quantities misleading.");
  }
  if (types.includes(ExtensionType.ScaledUiAmountConfig) && getScaledUiAmountConfig(mint)) {
    blockers.push("Token uses a scaled UI amount: displayed amounts differ from raw balances, which would make OTC quantities misleading.");
  }
  if (types.includes(ExtensionType.PausableConfig)) {
    const p = getPausableConfig(mint);
    if (p?.paused) blockers.push("Token transfers are currently paused by the token's pause authority.");
    else warnings.push("Token transfers can be paused by a pause authority.");
  }
  if (types.includes(ExtensionType.MintCloseAuthority)) {
    const mca = getMintCloseAuthority(mint);
    if (mca && !mca.closeAuthority.equals(PublicKey.default)) warnings.push("Mint has a close authority (only usable at zero supply).");
  }
  if (types.includes(ExtensionType.TokenMetadata)) {
    const data = getExtensionData(ExtensionType.TokenMetadata, mint.tlvData);
    if (data) {
      try {
        const md = unpackTokenMetadata(data);
        onChainMetadata = {
          name: md.name,
          symbol: md.symbol,
          uri: md.uri,
          updateAuthority: md.updateAuthority && !md.updateAuthority.equals(PublicKey.default) ? md.updateAuthority.toBase58() : null,
        };
      } catch {
        warnings.push("On-chain token metadata could not be decoded.");
      }
    }
  }

  if (mint.freezeAuthority) {
    const msg = "Token has a freeze authority that can freeze holder accounts.";
    if (opts.allowFreezeAuthority) warnings.push(msg);
    else blockers.push(msg);
  }
  if (mint.mintAuthority) warnings.push("Token still has a mint authority; supply can be increased.");
  if (!mint.isInitialized) blockers.push("Mint is not initialized.");

  return {
    mint: address.toBase58(),
    programId: info.owner,
    program,
    decimals: mint.decimals,
    supply: mint.supply,
    mintAuthority: mint.mintAuthority?.toBase58() ?? null,
    freezeAuthority: mint.freezeAuthority?.toBase58() ?? null,
    extensions: types.map(extensionName),
    transferFee,
    transferHookProgram,
    permanentDelegate,
    onChainMetadata,
    safety: { ok: blockers.length === 0, blockers, warnings },
  };
}

export async function inspectMint(connection: Connection, mint: PublicKey, opts: Omit<InspectOptions, "epoch"> = {}): Promise<MintInspection | null> {
  const [info, epochInfo] = await Promise.all([connection.getAccountInfo(mint), connection.getEpochInfo()]);
  if (!info) return null;
  return inspectMintAccount(mint, info, { ...opts, epoch: BigInt(epochInfo.epoch) });
}

/** Transfer fee withheld from `amount` under the given config (0 when none). */
export function transferFeeFor(fee: TransferFeeInfo | null, amount: bigint): bigint {
  if (!fee || fee.basisPoints === 0) return 0n;
  return calculateEpochFee(
    {
      transferFeeConfigAuthority: PublicKey.default,
      withdrawWithheldAuthority: PublicKey.default,
      withheldAmount: 0n,
      olderTransferFee: { epoch: fee.epoch, maximumFee: fee.maximumFee, transferFeeBasisPoints: fee.basisPoints },
      newerTransferFee: { epoch: fee.epoch, maximumFee: fee.maximumFee, transferFeeBasisPoints: fee.basisPoints },
    },
    fee.epoch,
    amount,
  );
}

export interface TokenAccountInspection {
  address: string;
  exists: boolean;
  owner: string | null;
  mint: string | null;
  amount: bigint;
  frozen: boolean;
  memoRequired: boolean;
}

export function inspectTokenAccountInfo(address: PublicKey, info: AccountInfo<Buffer> | null): TokenAccountInspection {
  if (!info) return { address: address.toBase58(), exists: false, owner: null, mint: null, amount: 0n, frozen: false, memoRequired: false };
  const program = programKind(info.owner);
  if (program === "spl-token" && info.data.length === ACCOUNT_SIZE) {
    const raw = AccountLayout.decode(info.data);
    return {
      address: address.toBase58(),
      exists: true,
      owner: raw.owner.toBase58(),
      mint: raw.mint.toBase58(),
      amount: raw.amount,
      frozen: raw.state === AccountState.Frozen,
      memoRequired: false,
    };
  }
  const acc = unpackAccount(address, info, info.owner);
  return {
    address: address.toBase58(),
    exists: true,
    owner: acc.owner.toBase58(),
    mint: acc.mint.toBase58(),
    amount: acc.amount,
    frozen: acc.isFrozen,
    memoRequired: getMemoTransfer(acc)?.requireIncomingTransferMemos ?? false,
  };
}
