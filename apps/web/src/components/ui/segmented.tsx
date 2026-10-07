"use client";
import { cn } from "@/lib/cn";

export function Segmented<T extends string>({ value, onChange, options, className, size = "md" }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; tone?: "buy" | "sell" }>; className?: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" className={cn("inline-flex rounded-[var(--radius-control)] border border-line bg-ink p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 rounded-[5px] font-medium transition-colors",
              size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]",
              active ? (o.tone === "buy" ? "bg-buy text-ink" : o.tone === "sell" ? "bg-sell text-ink" : "bg-raised text-text") : "text-muted hover:text-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
