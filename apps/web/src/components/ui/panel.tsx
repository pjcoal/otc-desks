import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A window (with PanelHeader) or a bevelled group box (without). */
export function Panel({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("panel", className)} {...p} />;
}

/** Inert window-control glyphs: decoration only, never focusable or clickable. */
export function WindowGlyphs() {
  return (
    <span className="ml-2 flex shrink-0 gap-0.5" aria-hidden>
      {["_", "□", "×"].map((g) => (
        <span key={g} className="flex size-4 items-center justify-center bg-panel text-[12px] leading-none text-text bevel-out">
          {g}
        </span>
      ))}
    </span>
  );
}

export function TitleBar({ title, icon, className, glyphs = true }: { title: ReactNode; icon?: ReactNode; className?: string; glyphs?: boolean }) {
  return (
    <div className={cn("titlebar flex h-7 min-w-0 items-center gap-1.5 px-1.5", className)}>
      {icon}
      <h2 className="min-w-0 flex-1 truncate text-[14px]">{title}</h2>
      {glyphs && <WindowGlyphs />}
    </div>
  );
}

export function PanelHeader({ title, action, className, children }: { title: ReactNode; action?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={className}>
      <TitleBar title={title} />
      {(action || children) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-[13px]">
          <div className="min-w-0 text-muted">{children}</div>
          {action}
        </div>
      )}
    </div>
  );
}

export function Row({ label, children, className, hint }: { label: ReactNode; children: ReactNode; className?: string; hint?: ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1", className)}>
      <dt className="text-muted">
        {label}
        {hint && <span className="block text-[13px] text-faint">{hint}</span>}
      </dt>
      <dd className="num text-right">{children}</dd>
    </div>
  );
}
