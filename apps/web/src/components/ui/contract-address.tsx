"use client";
import Link from "next/link";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/** The platform token's contract address (mint), shown in full and copyable. Configured by PLATFORM_TOKEN_MINT. */
export function ContractAddress({ mint, symbol, className }: { mint: string; symbol: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(mint);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-[14px] font-semibold">${symbol} contract address</p>
      <div className="flex flex-wrap items-stretch gap-2">
        <code className="min-w-0 flex-1 break-all bg-ink px-3 py-2 font-mono text-[13px] leading-snug bevel-in select-all">{mint}</code>
        <button type="button" onClick={copy} className={buttonClass({ className: "min-w-24" })} aria-live="polite">
          {copied ? "Copied" : "Copy"}
        </button>
        <Link href={`/token/${mint}`} className={buttonClass()}>
          Chart
        </Link>
      </div>
    </div>
  );
}

/** One-line version for the footer. */
export function ContractAddressLine({ mint, symbol }: { mint: string; symbol: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <p className="mb-1 break-all">
      ${symbol} CA:{" "}
      <button
        type="button"
        className="font-mono underline decoration-dotted underline-offset-2 hover:decoration-solid"
        title="Copy contract address"
        onClick={() => {
          void navigator.clipboard?.writeText(mint);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {mint}
      </button>
      {copied && <span className="ml-2">Copied</span>}
    </p>
  );
}
