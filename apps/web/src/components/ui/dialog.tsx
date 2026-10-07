"use client";
import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Dialog({ open, onOpenChange, title, description, children, className }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-[repeating-conic-gradient(rgba(0,0,0,0.35)_0%_25%,transparent_0%_50%)] bg-[length:4px_4px]" />
        <D.Content className={cn("panel fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-24px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto shadow-[6px_6px_0_rgba(0,0,0,0.35)]", className)}>
          <div className="titlebar flex h-7 items-center gap-2 px-1.5">
            <D.Title className="min-w-0 flex-1 truncate text-[14px]">{title}</D.Title>
            <D.Close className="flex size-5 items-center justify-center bg-panel text-[13px] leading-none text-text bevel-out active:bevel-in" aria-label="Close">
              ×
            </D.Close>
          </div>
          <div className="p-4">
            {description ? <D.Description className="mb-4 text-muted">{description}</D.Description> : <D.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</D.Description>}
            {children}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
