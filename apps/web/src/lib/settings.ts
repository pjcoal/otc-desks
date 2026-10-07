"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/** Per-device preferences only. Slippage is never changed silently; this is the user's chosen default. */
interface Settings {
  slippageBps: number;
  setSlippageBps: (bps: number) => void;
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      slippageBps: 100,
      setSlippageBps: (bps) => set({ slippageBps: Math.min(5000, Math.max(1, Math.round(bps))) }),
    }),
    {
      name: "otc-settings",
      storage: createJSONStorage(() => {
        try {
          return localStorage;
        } catch {
          return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        }
      }),
    },
  ),
);
