import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Bevelled push buttons. The default (primary) button carries the extra dark outline old dialogs used. */
const button = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap bg-panel font-medium text-text bevel-out active:bevel-in active:translate-x-px active:translate-y-px disabled:pointer-events-none disabled:text-faint disabled:[text-shadow:1px_1px_0_#fff]",
  {
    variants: {
      variant: {
        primary: "outline outline-1 outline-offset-0 outline-text",
        buy: "text-buy outline outline-1 outline-buy",
        sell: "text-sell outline outline-1 outline-sell",
        outline: "",
        ghost: "bg-transparent shadow-none [box-shadow:none] hover:bevel-out",
        danger: "text-sell",
      },
      size: { sm: "h-7 px-3 text-[13px]", md: "h-9 px-4 text-[14px]", lg: "h-11 px-5 text-[15px]" },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button> & { loading?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, block, loading, children, disabled, ...props }, ref) => (
  <button ref={ref} className={cn(button({ variant, size, block }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading && <span className="caret inline-block size-2.5 bg-current" aria-hidden />}
    {children}
  </button>
));
Button.displayName = "Button";

export { button as buttonClass };
