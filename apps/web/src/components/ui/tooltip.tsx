"use client";
import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";

export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <T.Provider delayDuration={300}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content sideOffset={6} className="z-50 max-w-xs border border-text bg-[#ffffe1] px-2 py-1 text-[13px] text-text">
            {content}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
