import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-raised", className)} aria-hidden />;
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-8">
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-prose text-muted">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className={cn("rounded-[var(--radius-control)] border border-sell/40 bg-sell-dim/40 px-3 py-2 text-[13px] text-sell", className)}>
      {message}
    </div>
  );
}
