import { getServerConfig } from "@app/shared/server";
import { createRpcProvider, type RpcProvider } from "./rpc";

const g = globalThis as unknown as { __rpc?: RpcProvider };

/** Process-wide RPC provider configured from env. */
export function getRpc(): RpcProvider {
  if (!g.__rpc) {
    const c = getServerConfig();
    g.__rpc = createRpcProvider({
      primaryUrl: c.SOLANA_RPC_URL,
      ...(c.SOLANA_RPC_FALLBACK_URL ? { fallbackUrl: c.SOLANA_RPC_FALLBACK_URL } : {}),
      ...(c.SOLANA_WS_URL ? { wsUrl: c.SOLANA_WS_URL } : {}),
    });
  }
  return g.__rpc;
}

export function setRpcForTests(rpc: RpcProvider | undefined): void {
  g.__rpc = rpc;
}
