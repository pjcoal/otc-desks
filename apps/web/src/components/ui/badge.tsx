import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const badge = cva("inline-flex items-center gap-1 rounded-[var(--radius-chip)] px-1.5 py-0.5 text-[12px] font-medium leading-none", {
  variants: {
    tone: {
      neutral: "bg-raised text-muted",
      buy: "bg-buy-dim text-buy",
      sell: "bg-sell-dim text-sell",
      brass: "bg-brass-dim text-brass",
      glacier: "bg-glacier-dim text-glacier",
      warn: "bg-warn-dim text-warn",
      outline: "border border-line-strong text-muted",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ tone, className, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}
