"use client";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/cn";
import type { ComponentProps } from "react";

export const Tabs = T.Root;
export function TabsList({ className, ...p }: ComponentProps<typeof T.List>) {
  return <T.List className={cn("flex gap-1 overflow-x-auto border-b border-line", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: ComponentProps<typeof T.Trigger>) {
  return <T.Trigger className={cn("-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-[13px] font-medium text-muted transition-colors hover:text-text data-[state=active]:border-text data-[state=active]:text-text", className)} {...p} />;
}
export const TabsContent = T.Content;
