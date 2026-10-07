import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config";

const base = { SESSION_SECRET: "x".repeat(40), PLATFORM_TREASURY_WALLET: "2xY4BjMjuixUxfBqeDVETntYnaNiHXwsDeUsjtRqxWDW" };

describe("deployment configuration guards", () => {
  it("devnet by default; transactions enabled", () => {
    const c = loadServerConfig(base);
    expect(c.SOLANA_CLUSTER).toBe("devnet");
    expect(c.transactionsEnabled).toBe(true);
  });
  it("mainnet is read-only unless explicitly allowed", () => {
    const c = loadServerConfig({ ...base, SOLANA_CLUSTER: "mainnet-beta" });
    expect(c.transactionsEnabled).toBe(false);
  });
  it("ALLOW_MAINNET demands the checklist acknowledgement and production prerequisites", () => {
    expect(() => loadServerConfig({ ...base, SOLANA_CLUSTER: "mainnet-beta", ALLOW_MAINNET: "true" })).toThrow(/MAINNET_CHECKLIST_COMPLETED[\s\S]*SOLANA_RPC_FALLBACK_URL[\s\S]*REDIS_URL[\s\S]*APP_URL/);
    const ok = loadServerConfig({ ...base, SOLANA_CLUSTER: "mainnet-beta", ALLOW_MAINNET: "true", MAINNET_CHECKLIST_COMPLETED: "yes", SOLANA_RPC_FALLBACK_URL: "https://fallback.example", REDIS_URL: "redis://r", APP_URL: "https://otc.example" });
    expect(ok.transactionsEnabled).toBe(true);
  });
  it("demo mode can never run against mainnet", () => {
    expect(() => loadServerConfig({ ...base, SOLANA_CLUSTER: "mainnet-beta", ALLOW_MAINNET: "true", MAINNET_CHECKLIST_COMPLETED: "yes", SOLANA_RPC_FALLBACK_URL: "https://f.example", REDIS_URL: "redis://r", APP_URL: "https://otc.example", DEMO_MODE: "true" })).toThrow(/DEMO_MODE/);
  });
  it("a platform fee requires a treasury, and production requires a real session secret", () => {
    expect(() => loadServerConfig({ SESSION_SECRET: "x".repeat(40) })).toThrow(/PLATFORM_TREASURY_WALLET/);
    expect(() => loadServerConfig({ NODE_ENV: "production", PLATFORM_TREASURY_WALLET: base.PLATFORM_TREASURY_WALLET })).toThrow(/SESSION_SECRET/);
  });
});
