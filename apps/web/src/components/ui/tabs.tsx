"use client";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/cn";
import type { ComponentProps } from "react";

export const Tabs = T.Root;
/** Property-sheet tabs: the active tab rises and joins the sheet below. */
export function TabsList({ className, ...p }: ComponentProps<typeof T.List>) {
  return <T.List className={cn("flex gap-0.5 overflow-x-auto border-b border-bevel-lo px-1 pt-1", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "-mb-px whitespace-nowrap bg-raised px-3 pb-1 pt-1 text-[14px] text-muted [box-shadow:inset_1px_1px_0_var(--color-bevel-hi),inset_-1px_0_0_var(--color-bevel-dk)] data-[state=active]:-mt-1 data-[state=active]:bg-panel data-[state=active]:pb-2 data-[state=active]:font-semibold data-[state=active]:text-text",
        className,
      )}
      {...p}
    />
  );
}
export const TabsContent = T.Content;
