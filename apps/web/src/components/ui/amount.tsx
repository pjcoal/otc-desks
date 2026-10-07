import { cn } from "@/lib/cn";
import { sol, tokens } from "@/lib/format";

/** SOL leg: glacier. */
export function Sol({ lamports, digits = 4, className, unit = true }: { lamports: string | bigint | null | undefined; digits?: number; className?: string; unit?: boolean }) {
  return (
    <span className={cn("num text-glacier", className)}>
      {sol(lamports, digits)}
      {unit && <span className="ml-1 text-glacier/70">SOL</span>}
    </span>
  );
}

/** Token leg: brass. */
export function Tokens({ raw, decimals, symbol, digits = 2, className }: { raw: string | bigint | null | undefined; decimals: number; symbol?: string; digits?: number; className?: string }) {
  return (
    <span className={cn("num text-brass", className)}>
      {tokens(raw, decimals, digits)}
      {symbol && <span className="ml-1 text-brass/70">{symbol}</span>}
    </span>
  );
}
