import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { suffix?: ReactNode; invalid?: boolean }>(({ className, suffix, invalid, ...p }, ref) => (
  <div className={cn("flex h-9 items-center bg-ink px-2.5 bevel-in focus-within:outline focus-within:outline-1 focus-within:outline-dotted focus-within:-outline-offset-4", invalid && "bg-sell-dim", className)}>
    <input ref={ref} className="num h-full w-full min-w-0 bg-transparent text-[15px] text-text outline-none placeholder:text-faint" {...p} />
    {suffix && <span className="ml-2 shrink-0 text-muted">{suffix}</span>}
  </div>
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn("min-h-20 w-full bg-ink px-2.5 py-2 text-text outline-none bevel-in placeholder:text-faint", className)} {...p} />
));
Textarea.displayName = "Textarea";

export function Field({ label, htmlFor, hint, error, children, className }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={htmlFor} className="block text-[14px] text-text">
        {label}
      </label>
      {children}
      {error ? <p className="text-[13px] text-sell">{error}</p> : hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}
