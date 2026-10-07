/**
 * Pyth SOL/USD from chain: the sponsored price-feed account maintained by the Pyth receiver program.
 * Used for display (USD market caps) and listing thresholds only, never to price a trade or settlement.
 *
 * Account layout (PriceUpdateV2, Anchor): discriminator(8) | write_authority(32) |
 * verification_level (Partial = 0 + u8, Full = 1) | feed_id(32) | price i64 | conf u64 | exponent i32 |
 * publish_time i64 | prev_publish_time i64 | ema_price i64 | ema_conf u64 | posted_slot u64.
 */
import { PublicKey, type AccountInfo } from "@solana/web3.js";

export const PYTH_RECEIVER_PROGRAM = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
/** Sponsored SOL/USD feed account (push oracle, shard 0). */
export const PYTH_SOL_USD_ACCOUNT = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
export const PYTH_SOL_USD_FEED_ID = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
/** sha256("account:PriceUpdateV2")[0..8] */
const PRICE_UPDATE_V2_DISCRIMINATOR = "22f123639d7ef4cd";

export interface PythPrice {
  /** Integer mantissa; value = price × 10^exponent. */
  price: bigint;
  conf: bigint;
  exponent: number;
  publishTime: number;
  fullyVerified: boolean;
}

/** Decode and validate a PriceUpdateV2 account. Returns null for anything that is not a sane, fresh price. */
export function decodePythPrice(info: AccountInfo<Buffer> | null, opts: { feedId: string; nowSec: number; maxAgeSec: number; maxConfBps: number }): PythPrice | null {
  if (!info || !info.owner.equals(PYTH_RECEIVER_PROGRAM)) return null;
  const d = info.data;
  if (d.length < 8 + 32 + 2 + 32 + 8 + 8 + 4 + 8) return null;
  if (d.subarray(0, 8).toString("hex") !== PRICE_UPDATE_V2_DISCRIMINATOR) return null;
  let o = 40;
  const level = d[o];
  if (level === 0) o += 2;
  else if (level === 1) o += 1;
  else return null;
  if (d.subarray(o, o + 32).toString("hex") !== opts.feedId) return null;
  o += 32;
  const price = d.readBigInt64LE(o);
  const conf = d.readBigUInt64LE(o + 8);
  const exponent = d.readInt32LE(o + 16);
  const publishTime = Number(d.readBigInt64LE(o + 20));
  if (price <= 0n || exponent > 0 || exponent < -18) return null;
  if (opts.nowSec - publishTime > opts.maxAgeSec) return null;
  if (conf * 10_000n > price * BigInt(opts.maxConfBps)) return null;
  return { price, conf, exponent, publishTime, fullyVerified: level === 1 };
}
