"use client";
import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";

export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <T.Provider delayDuration={150}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content sideOffset={6} className="z-50 max-w-xs rounded-md border border-line bg-raised px-2.5 py-1.5 text-[12px] text-text shadow-lg">
            {content}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
