"use client";
import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Popover } from "radix-ui";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { bps as fmtBps } from "@/lib/format";

/** Slippage is always explicit and visible. It only changes when the user changes it. */
export function SlippageControl({ value, onChange }: { value: number; onChange: (bps: number) => void }) {
  const [custom, setCustom] = useState("");
  const presets = ["50", "100", "300"] as const;
  const preset = presets.find((p) => Number(p) === value);
  return (
    <Popover.Root>
      <Popover.Trigger className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[13px] text-muted hover:bg-hover hover:text-text">
        <Settings2 className="size-3.5" /> Slippage {fmtBps(value)}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="panel z-50 w-64 space-y-3 p-3 shadow-xl">
          <p className="text-[13px] text-muted">Your transaction fails instead of filling worse than this.</p>
          <Segmented value={preset ?? ("custom" as never)} onChange={(v) => onChange(Number(v))} options={presets.map((p) => ({ value: p, label: fmtBps(Number(p)) }))} className="w-full" size="sm" />
          <Input
            value={custom}
            placeholder="Custom %"
            inputMode="decimal"
            suffix="%"
            onChange={(e) => {
              setCustom(e.target.value);
              const pct = Number(e.target.value);
              if (Number.isFinite(pct) && pct > 0 && pct <= 50) onChange(Math.round(pct * 100));
            }}
          />
          {value > 500 && <p className="text-[13px] text-warn">High slippage: you may receive much less than quoted.</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
