"use client";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";
import { useAuth } from "./auth";

/**
 * One EventSource per tab. Pages declare which mint they watch; incoming events invalidate the
 * matching React Query caches so data is refetched from the API (never trusted from the stream).
 */
const Ctx = createContext<(mint: string | null) => void>(() => {});

export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { wallet } = useAuth();
  const [mint, setMint] = useState<string | null>(null);
  useEffect(() => {
    const es = new EventSource(`/api/stream${mint ? `?mint=${mint}` : ""}`);
    es.addEventListener("market", () => void qc.invalidateQueries({ queryKey: ["token", mint] }));
    es.addEventListener("otc", () => {
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["otc-trades"] });
    });
    es.addEventListener("wallet", (ev) => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["deal"] });
      void qc.invalidateQueries({ queryKey: ["settlement"] });
      try {
        const m = JSON.parse((ev as MessageEvent).data as string) as { title?: string };
        if (m.title) toast.info(m.title);
      } catch {
        // ignore malformed
      }
    });
    return () => es.close();
  }, [mint, wallet, qc]);
  return <Ctx.Provider value={setMint}>{children}</Ctx.Provider>;
}

export function useLiveMint(mint: string | null) {
  const set = useContext(Ctx);
  useEffect(() => {
    set(mint);
    return () => set(null);
  }, [mint, set]);
}
