"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import bs58 from "bs58";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, post } from "@/lib/api";
import { toast } from "@/components/ui/toast";

interface SessionInfo {
  wallet: string | null;
  referralCode?: string | null;
  isAdmin?: boolean;
  expiresAt?: string;
}

interface AuthValue {
  session: SessionInfo | undefined;
  /** Signed-in wallet, only when it matches the connected wallet. */
  wallet: string | null;
  connected: string | null;
  status: "loading" | "disconnected" | "signed-out" | "signed-in";
  signingIn: boolean;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, connected } = useWallet();
  const qc = useQueryClient();
  const connectedAddr = publicKey?.toBase58() ?? null;
  const { data: session, isLoading } = useQuery({ queryKey: ["session"], queryFn: () => api<SessionInfo>("/api/auth/session"), staleTime: 60_000 });
  const [signingIn, setSigningIn] = useState(false);
  const lastConnected = useRef<string | null>(null);

  const signOut = useCallback(async () => {
    await post("/api/auth/logout", {}).catch(() => {});
    await qc.invalidateQueries();
  }, [qc]);

  // Account change detection: a session may never act for a different wallet than the one connected.
  useEffect(() => {
    if (connectedAddr && lastConnected.current && lastConnected.current !== connectedAddr && session?.wallet && session.wallet !== connectedAddr) {
      toast.info("Wallet changed", "Sign in again to act with the newly selected account.");
      void signOut();
    }
    if (connectedAddr) lastConnected.current = connectedAddr;
  }, [connectedAddr, session?.wallet, signOut]);

  const signIn = useCallback(async () => {
    if (!publicKey) return false;
    if (!signMessage) {
      toast.error("This wallet cannot sign messages", "Use a wallet that supports message signing (Phantom, Solflare, Backpack).");
      return false;
    }
    setSigningIn(true);
    try {
      const wallet = publicKey.toBase58();
      const { nonce, message } = await post<{ nonce: string; message: string }>("/api/auth/nonce", { wallet });
      const sig = await signMessage(new TextEncoder().encode(message));
      await post("/api/auth/verify", { wallet, nonce, signature: bs58.encode(sig) });
      await qc.invalidateQueries();
      toast.success("Signed in", "Your wallet address is now your identity on this device.");
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Sign-in failed", /reject|cancel|denied/i.test(msg) ? "You declined the signature request." : msg);
      return false;
    } finally {
      setSigningIn(false);
    }
  }, [publicKey, signMessage, qc]);

  const value = useMemo<AuthValue>(() => {
    const matched = session?.wallet && session.wallet === connectedAddr ? session.wallet : null;
    const status = isLoading ? "loading" : !connected ? "disconnected" : matched ? "signed-in" : "signed-out";
    return { session, wallet: matched, connected: connectedAddr, status, signingIn, signIn, signOut };
  }, [session, connectedAddr, connected, isLoading, signingIn, signIn, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
