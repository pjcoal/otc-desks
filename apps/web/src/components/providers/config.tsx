"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { PublicConfig } from "@/server/context";

const Ctx = createContext<PublicConfig | null>(null);

export function ConfigProvider({ value, children }: { value: PublicConfig; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConfig(): PublicConfig {
  const c = useContext(Ctx);
  if (!c) throw new Error("ConfigProvider missing");
  return c;
}
