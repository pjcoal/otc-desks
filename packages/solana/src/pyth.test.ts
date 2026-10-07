import { describe, expect, it } from "vitest";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { decodePythPrice, PYTH_RECEIVER_PROGRAM, PYTH_SOL_USD_FEED_ID } from "./pyth";

// Real mainnet account data for the sponsored SOL/USD feed (7UVimffx…), captured 2026-10-07.
const DATA = Buffer.from("IvEjY51+9M1gMUcENA3t3zcf1CRyFI8kjp0abRpesqw6zYt/1dayQwHvDYtv2izrpB2hXUCV0do5Kg0vjtDGx7wPTPrIwoC1beNDCsMCAAAAd+YyAAAAAAD4////Av3FagAAAAAB/cVqAAAAAHipn8MCAAAAYp0mAAAAAACN/REbAAAAAAA=", "base64");
const PUBLISHED = 1_791_360_258; // 2026-10-07T08:04:18Z
const account = (data = DATA, owner = PYTH_RECEIVER_PROGRAM): AccountInfo<Buffer> => ({ data, owner, lamports: 1, executable: false, rentEpoch: 0 });
const opts = { feedId: PYTH_SOL_USD_FEED_ID, nowSec: PUBLISHED + 10, maxAgeSec: 300, maxConfBps: 200 };

describe("Pyth PriceUpdateV2 decoding", () => {
  it("decodes the real SOL/USD account", () => {
    expect(decodePythPrice(account(), opts)).toEqual({ price: 11_862_164_451n, conf: 3_335_799n, exponent: -8, publishTime: PUBLISHED, fullyVerified: true });
  });
  it("rejects the wrong owner, discriminator or feed, stale prices and wide confidence", () => {
    expect(decodePythPrice(account(DATA, PublicKey.default), opts)).toBeNull();
    const badDisc = Buffer.from(DATA);
    badDisc[0] = 0;
    expect(decodePythPrice(account(badDisc), opts)).toBeNull();
    expect(decodePythPrice(account(), { ...opts, feedId: "00".repeat(32) })).toBeNull();
    expect(decodePythPrice(account(), { ...opts, nowSec: PUBLISHED + 301 })).toBeNull();
    expect(decodePythPrice(account(), { ...opts, maxConfBps: 1 })).toBeNull();
    expect(decodePythPrice(null, opts)).toBeNull();
    expect(decodePythPrice(account(DATA.subarray(0, 60)), opts)).toBeNull();
  });
});
