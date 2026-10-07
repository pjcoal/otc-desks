import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Panel({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("panel", className)} {...p} />;
}

export function PanelHeader({ title, action, className, children }: { title: ReactNode; action?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-line px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {children}
      </div>
      {action}
    </div>
  );
}

export function Row({ label, children, className, hint }: { label: ReactNode; children: ReactNode; className?: string; hint?: ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5", className)}>
      <dt className="text-muted">
        {label}
        {hint && <span className="block text-[12px] text-faint">{hint}</span>}
      </dt>
      <dd className="num text-right">{children}</dd>
    </div>
  );
}
