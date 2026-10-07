"use client";
import { useQuery } from "@tanstack/react-query";
import { CandlestickSeries, HistogramSeries, createChart, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { D, formatPrice } from "@app/shared";
import { api } from "@/lib/api";
import { Segmented } from "@/components/ui/segmented";

const TF = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
type Tf = (typeof TF)[number];
interface Candle {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeLamports: string;
  trades: number;
}

/**
 * Candles come only from indexed Pump/PumpSwap trades. Gaps stay gaps; with little data we say so.
 * (Converting decimal strings to JS numbers here is display-only — never used for accounting.)
 */
export function PriceChart({ mint }: { mint: string }) {
  const [tf, setTf] = useState<Tf>("15m");
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["candles", mint, tf], queryFn: () => api<{ candles: Candle[]; coverageFrom: string | null }>(`/api/tokens/${mint}/candles?tf=${tf}`), refetchInterval: 30_000 });

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: "#fbfaf5" }, textColor: "#55514a", fontFamily: "inherit", attributionLogo: false },
      grid: { vertLines: { color: "#ebe7dd" }, horzLines: { color: "#ebe7dd" } },
      rightPriceScale: { borderColor: "#8e897d" },
      timeScale: { borderColor: "#8e897d", timeVisible: true },
      localization: { priceFormatter: (p: number) => formatPrice(new D(p.toPrecision(8)), 4) },
    });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c || !data) return;
    const candles = c.addSeries(CandlestickSeries, { upColor: "#1d6b37", downColor: "#a3261b", borderVisible: false, wickUpColor: "#1d6b37", wickDownColor: "#a3261b", priceFormat: { type: "price", precision: 12, minMove: 1e-12 } });
    const volume = c.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, color: "#b9b3a6" });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    candles.setData(data.candles.map((k) => ({ time: k.time as UTCTimestamp, open: Number(k.open), high: Number(k.high), low: Number(k.low), close: Number(k.close) })));
    volume.setData(data.candles.map((k) => ({ time: k.time as UTCTimestamp, value: Number(k.volumeLamports) / 1e9, color: Number(k.close) >= Number(k.open) ? "#1d6b3755" : "#a3261b55" })));
    c.timeScale().fitContent();
    return () => {
      c.removeSeries(candles);
      c.removeSeries(volume);
    };
  }, [data]);

  const few = data && data.candles.length < 3;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <Segmented value={tf} onChange={setTf} options={TF.map((t) => ({ value: t, label: t }))} size="sm" />
        <span className="text-[13px] text-faint">{data?.coverageFrom ? `Indexed since ${new Date(data.coverageFrom).toLocaleDateString()}` : ""}</span>
      </div>
      <div className="relative m-2 h-[320px] bevel-in bg-ink p-[3px]">
        <div ref={el} className="absolute inset-0" />
        {(isLoading || few) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="max-w-xs text-center text-[13px] text-muted">{isLoading ? "Loading trades…" : data?.candles.length ? `Only ${data.candles.length} ${tf} candle${data.candles.length === 1 ? "" : "s"} of indexed trading so far.` : "No indexed trades yet for this token. The chart fills in as trades happen."}</p>
          </div>
        )}
      </div>
    </div>
  );
}
