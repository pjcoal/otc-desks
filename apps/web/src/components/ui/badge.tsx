import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const badge = cva("inline-flex items-center gap-1 border px-1.5 py-px text-[13px] leading-tight", {
  variants: {
    tone: {
      neutral: "border-line-strong bg-raised text-muted",
      buy: "border-buy/60 bg-buy-dim text-buy",
      sell: "border-sell/60 bg-sell-dim text-sell",
      brass: "border-brass/50 bg-brass-dim text-brass",
      glacier: "border-glacier/50 bg-glacier-dim text-glacier",
      warn: "border-warn/50 bg-warn-dim text-warn",
      outline: "border-line-strong text-muted",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ tone, className, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}
