"use client";
import { Buffer } from "buffer";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { WalletError } from "@solana/wallet-adapter-base";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { PublicConfig } from "@/server/context";
import { ConfigProvider } from "./config";
import { AuthProvider } from "./auth";
import { Toaster, toast } from "@/components/ui/toast";
import { LiveProvider } from "./live";

if (typeof window !== "undefined" && !(window as unknown as { Buffer?: unknown }).Buffer) {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

export function AppProviders({ config, children }: { config: PublicConfig; children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <ConfigProvider value={config}>
      <QueryClientProvider client={qc}>
        <ConnectionProvider endpoint={config.rpcUrl} config={{ commitment: "confirmed" }}>
          {/* wallets=[]: every Wallet Standard wallet (Phantom, Solflare, Backpack, …) is discovered automatically. */}
          <WalletProvider wallets={[]} autoConnect onError={(e: WalletError) => toast.error("Wallet error", e.message || e.name)}>
            <AuthProvider>
              <LiveProvider>{children}</LiveProvider>
              <Toaster />
            </AuthProvider>
          </WalletProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </ConfigProvider>
  );
}
