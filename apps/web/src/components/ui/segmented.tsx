"use client";
import { cn } from "@/lib/cn";

/** A toolbar of toggle buttons: the selected one stays pressed in. */
export function Segmented<T extends string>({ value, onChange, options, className, size = "md" }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; tone?: "buy" | "sell" }>; className?: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" className={cn("inline-flex flex-wrap gap-0.5", className)}>
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
              "flex-1 whitespace-nowrap bg-panel",
              size === "sm" ? "h-7 px-2.5 text-[13px]" : "h-8 px-3 text-[14px]",
              active ? "bevel-in bg-hover font-semibold" : "bevel-out text-muted hover:text-text",
              active && o.tone === "buy" && "text-buy",
              active && o.tone === "sell" && "text-sell",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
