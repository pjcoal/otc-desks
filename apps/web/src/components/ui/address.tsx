"use client";
import { Check, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { explorerAccountUrl, explorerTxUrl, shortAddress } from "@app/shared";
import { useConfig } from "@/components/providers/config";
import { cn } from "@/lib/cn";

/** Addresses are always copyable in full and linked to an explorer; abbreviation is display only. */
export function Address({ value, kind = "account", chars = 4, profile = false, className, full = false }: { value: string; kind?: "account" | "tx"; chars?: number; profile?: boolean; className?: string; full?: boolean }) {
  const { cluster } = useConfig();
  const [copied, setCopied] = useState(false);
  const text = full ? value : shortAddress(value, chars);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 font-mono text-[12.5px]", className)} title={value}>
      {profile && kind === "account" ? (
        <Link href={`/wallet/${value}`} className="truncate hover:text-text hover:underline">
          {text}
        </Link>
      ) : (
        <span className="truncate">{text}</span>
      )}
      <button
        type="button"
        className="shrink-0 rounded p-0.5 text-faint hover:text-text"
        aria-label={`Copy ${value}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
      <a href={kind === "tx" ? explorerTxUrl(value, cluster) : explorerAccountUrl(value, cluster)} target="_blank" rel="noreferrer noopener" className="shrink-0 rounded p-0.5 text-faint hover:text-text" aria-label="Open in explorer">
        <ExternalLink className="size-3" />
      </a>
    </span>
  );
}
