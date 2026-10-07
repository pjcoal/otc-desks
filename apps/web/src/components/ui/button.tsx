import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const button = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 rounded-[var(--radius-control)]",
  {
    variants: {
      variant: {
        primary: "bg-text text-ink hover:bg-white",
        buy: "bg-buy text-ink hover:brightness-110",
        sell: "bg-sell text-ink hover:brightness-110",
        outline: "border border-line-strong text-text hover:bg-hover",
        ghost: "text-muted hover:text-text hover:bg-hover",
        danger: "border border-sell/50 text-sell hover:bg-sell-dim",
      },
      size: { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-[15px]" },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button> & { loading?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, block, loading, children, disabled, ...props }, ref) => (
  <button ref={ref} className={cn(button({ variant, size, block }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
    {children}
  </button>
));
Button.displayName = "Button";

export { button as buttonClass };
