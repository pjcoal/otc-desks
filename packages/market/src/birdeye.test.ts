import { afterEach, describe, expect, it, vi } from "vitest";
import { BirdeyeApi } from "./birdeye";

const A = "9d24jNVbvHQH3pCB1ZzxRjpFuVV4j1MMJDU3SPxQpump";
const B = "2rXTptX8axpo1c8KJ4WPL2VusxyFGGckUZ9UErs7QPvp";
const C = "7c23msBoMSmCAcTkFJd4vksE2XfrPmG9U2xffi86pump";
const entry = (fees: unknown) => ({ alltime: { summary: { sum_global_fee_paid_amount_sol: fees, sum_priority_fee_amount_sol: 1 } } });

afterEach(() => vi.unstubAllGlobals());
const stub = (body: unknown, status = 200) => {
  const f = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", f);
  return f;
};

describe("Birdeye global fees adapter (untrusted input)", () => {
  it("reads all-time fees in lamports and drops malformed entries", async () => {
    const f = stub({ success: true, data: { [A]: entry(31.844065518), [B]: entry(-1), [C]: { nope: true } } });
    const fees = await new BirdeyeApi("https://example.test", "key").globalFeesLamports([A, B, C, "bad"]);
    expect(fees).toEqual(new Map([[A, 31_844_065_518n]]));
    const [url, init] = f.mock.calls[0]!;
    expect(url.pathname).toBe("/defi/v3/token/fee/multiple");
    expect(url.searchParams.get("list_address")).toBe([A, B, C].join(","));
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("key");
  });
  it("fails loudly on HTTP errors and unsuccessful responses", async () => {
    stub({ success: false, message: "Unauthorized" }, 401);
    await expect(new BirdeyeApi("https://example.test", "key").globalFeesLamports([A])).rejects.toThrow(/401/);
    stub({ success: false, message: "nope" });
    await expect(new BirdeyeApi("https://example.test", "key").globalFeesLamports([A])).rejects.toThrow(/unexpected shape/);
  });
});
