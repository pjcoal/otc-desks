import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { suffix?: ReactNode; invalid?: boolean }>(({ className, suffix, invalid, ...p }, ref) => (
  <div className={cn("flex h-10 items-center rounded-[var(--radius-control)] border bg-ink px-3 focus-within:border-glacier", invalid ? "border-sell" : "border-line", className)}>
    <input ref={ref} className="num h-full w-full min-w-0 bg-transparent text-[15px] text-text outline-none placeholder:text-faint" {...p} />
    {suffix && <span className="ml-2 shrink-0 text-muted">{suffix}</span>}
  </div>
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn("min-h-20 w-full rounded-[var(--radius-control)] border border-line bg-ink px-3 py-2 text-text outline-none placeholder:text-faint focus:border-glacier", className)} {...p} />
));
Textarea.displayName = "Textarea";

export function Field({ label, htmlFor, hint, error, children, className }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? <p className="text-[12px] text-sell">{error}</p> : hint ? <p className="text-[12px] text-faint">{hint}</p> : null}
    </div>
  );
}
