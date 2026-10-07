import { afterEach, describe, expect, it, vi } from "vitest";
import { PumpDiscoveryApi } from "./discovery";

const good = {
  mint: "9d24jNVbvHQH3pCB1ZzxRjpFuVV4j1MMJDU3SPxQpump",
  name: "Pudgy Penguins",
  symbol: "PENGU",
  image_uri: "https://ipfs.io/ipfs/QmX",
  creator: "2rXTptX8axpo1c8KJ4WPL2VusxyFGGckUZ9UErs7QPvp",
  created_timestamp: 1733582023924,
  complete: false,
  virtual_sol_reserves: 31_000_000_000,
  virtual_token_reserves: "1000000000000000",
  real_token_reserves: 720_100_000_000_000,
  base_decimals: 6,
  market_cap: 31.0,
};

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

describe("Pump discovery adapter (untrusted input)", () => {
  it("parses reserves as integers and keeps only validated fields", async () => {
    stub([good]);
    const [c] = await new PumpDiscoveryApi("https://example.test").listCoins("market_cap");
    expect(c).toMatchObject({ mint: good.mint, symbol: "PENGU", decimals: 6, virtualSolReserves: 31_000_000_000n, virtualTokenReserves: 1_000_000_000_000_000n, realTokenReserves: 720_100_000_000_000n });
  });
  it("drops malformed, banned and NSFW records instead of trusting them partially", async () => {
    stub([good, { ...good, mint: "not-a-mint" }, { ...good, virtual_sol_reserves: -5 }, { ...good, is_banned: true }, { ...good, nsfw: true }, "junk"]);
    expect(await new PumpDiscoveryApi("https://example.test").listCoins("created_timestamp")).toHaveLength(1);
  });
  it("fails loudly on HTTP errors and unexpected shapes", async () => {
    stub({ error: "nope" }, 503);
    await expect(new PumpDiscoveryApi("https://example.test").listCoins("market_cap")).rejects.toThrow(/503/);
    stub({ not: "an array" });
    await expect(new PumpDiscoveryApi("https://example.test").listCoins("market_cap")).rejects.toThrow(/unexpected shape/);
  });
});
