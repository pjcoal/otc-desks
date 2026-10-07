import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center bg-ink bevel-in", className)} aria-hidden>
      <span className="text-[13px] text-faint">Loading<span className="caret">_</span></span>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-6">
      <p className="font-semibold">{title}</p>
      {children && <p className="max-w-prose text-muted">{children}</p>}
      {action}
    </div>
  );
}

/** An error message box: red stop sign + text. */
export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className={cn("flex items-start gap-2.5 bg-ink px-3 py-2 text-[14px] text-text bevel-in", className)}>
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center bg-sell text-[13px] font-bold text-white [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)]" aria-hidden>
        ×
      </span>
      <span>{message}</span>
    </div>
  );
}
