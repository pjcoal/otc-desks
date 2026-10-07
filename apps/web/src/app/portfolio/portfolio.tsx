"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { relativeTime } from "@app/shared";
import type { NegotiationView, OrderView } from "@app/otc";
import { api } from "@/lib/api";
import { price } from "@/lib/format";
import type { OtcTradeRow } from "@/lib/types";
import { useAuth } from "@/components/providers/auth";
import { Address } from "@/components/ui/address";
import { Sol, Tokens } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Empty, ErrorNote, Skeleton } from "@/components/ui/skeleton";
import { DemoBadge, SideBadge, StatusPill, VenueBadge } from "@/components/ui/status";
import { TokenAvatar } from "@/components/ui/token-avatar";

export interface PortfolioData {
  wallet: string;
  isSelf: boolean;
  solLamports: string;
  positions: Array<{ mint: string; symbol: string; name: string; imageUrl: string | null; decimals: number; balanceRaw: string; venue: string; priceSolPerToken: string | null; estimatedValueLamports: string | null; pnlLamports: string | null; costBasisNote: string; isDemo: boolean }>;
  openOrders: OrderView[];
  otcHistory: OtcTradeRow[];
  createdTokens: Array<{ mint: string; symbol: string; name: string; imageUrl: string | null; venue: string; createdAt: string; marketCapLamports: string | null }>;
}

export function Portfolio() {
  const { publicKey, connected } = useWallet();
  const { wallet, status, signIn, signingIn } = useAuth();
  const addr = publicKey?.toBase58();
  const { data, isLoading, error } = useQuery({ queryKey: ["portfolio", addr, wallet], enabled: !!addr, queryFn: () => api<PortfolioData>(`/api/portfolio/${addr}`), refetchInterval: 30_000 });
  const negotiations = useQuery({ queryKey: ["negotiations", wallet], enabled: !!wallet, queryFn: () => api<{ negotiations: NegotiationView[] }>("/api/otc/negotiations") });

  if (!connected) return <Empty title="Connect a wallet to see your portfolio">Balances are read from the chain; nothing is stored about wallets you don't sign in with.</Empty>;
  if (isLoading || !data) return error ? <ErrorNote error={error} /> : <Skeleton className="h-96" />;

  const total = data.positions.reduce((a, p) => a + BigInt(p.estimatedValueLamports ?? "0"), 0n);
  const pending = negotiations.data?.negotiations.filter((n) => n.status === "OPEN" || n.status === "AGREED") ?? [];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title-display text-[44px] leading-none">Portfolio</h1>
          <p className="mt-2 flex items-center gap-2 text-muted"><Address value={data.wallet} chars={6} /></p>
        </div>
        <dl className="flex gap-8">
          <div>
            <dt className="text-[12px] text-muted">SOL balance</dt>
            <dd className="text-[22px]"><Sol lamports={data.solLamports} /></dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">Pump positions (estimate)</dt>
            <dd className="text-[22px]"><Sol lamports={total} /></dd>
          </div>
        </dl>
      </div>
      {status === "signed-out" && (
        <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-muted">Sign in to see your private offers, negotiations and full OTC history.</p>
          <Button onClick={() => void signIn()} loading={signingIn}>Sign in</Button>
        </Panel>
      )}

      <Panel>
        <PanelHeader title="Positions" />
        {!data.positions.length ? (
          <Empty title="No Pump tokens in this wallet">Tokens appear once you hold a Pump coin this app has indexed.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="text-left text-[12px] text-faint">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">Token</th>
                  <th className="px-2 py-2 font-medium">Balance</th>
                  <th className="px-2 py-2 font-medium">Price</th>
                  <th className="px-2 py-2 font-medium">Est. value</th>
                  <th className="px-2 py-2 font-medium">PnL</th>
                  <th className="px-4 py-2 font-medium">Venue</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => (
                  <tr key={p.mint} className="border-b border-line/60 hover:bg-hover/60">
                    <td className="px-4 py-2.5">
                      <Link href={`/token/${p.mint}`} className="flex items-center gap-2"><TokenAvatar src={p.imageUrl} symbol={p.symbol} size={24} />{p.symbol} <DemoBadge show={p.isDemo} /></Link>
                    </td>
                    <td className="px-2 py-2.5"><Tokens raw={p.balanceRaw} decimals={p.decimals} /></td>
                    <td className="num px-2 py-2.5">{price(p.priceSolPerToken)}</td>
                    <td className="px-2 py-2.5"><Sol lamports={p.estimatedValueLamports} digits={3} /></td>
                    <td className="px-2 py-2.5" title={p.costBasisNote}>
                      {p.pnlLamports === null ? <span className="text-faint">Unavailable</span> : <span className={BigInt(p.pnlLamports) >= 0n ? "text-buy" : "text-sell"}>{BigInt(p.pnlLamports) >= 0n ? "+" : "−"}<Sol lamports={(BigInt(p.pnlLamports) < 0n ? -BigInt(p.pnlLamports) : BigInt(p.pnlLamports)).toString()} digits={3} /></span>}
                    </td>
                    <td className="px-4 py-2.5"><VenueBadge venue={p.venue} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-2 text-[12px] text-faint">Values use the latest indexed Pump price and ignore slippage. PnL is shown only when your indexed trades fully explain your balance.</p>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Open orders" />
          {!data.openOrders.length ? <Empty title="No open orders" /> : (
            <ul className="divide-y divide-line">
              {data.openOrders.map((o) => (
                <li key={o.id}>
                  <Link href={`/deal/${o.publicId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover/60">
                    <SideBadge side={o.side} />
                    <span className="min-w-0 flex-1 truncate">{o.token.symbol} <Tokens raw={o.remainingAmountRaw} decimals={o.token.decimals} /> for <Sol lamports={o.quoteAmountRaw} digits={3} /></span>
                    <StatusPill status={o.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Pending negotiations" />
          {!wallet ? <Empty title="Sign in to see negotiations" /> : !pending.length ? <Empty title="Nothing pending" /> : (
            <ul className="divide-y divide-line">
              {pending.map((n) => {
                const latest = n.revisions[n.revisions.length - 1]!;
                return (
                  <li key={n.id}>
                    <Link href={`/deal/${latest.publicId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover/60">
                      <span className="min-w-0 flex-1 truncate">{latest.token.symbol} revision {latest.revision}: <Sol lamports={latest.quoteAmountRaw} digits={3} /></span>
                      <StatusPill status={latest.status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="OTC trade history" />
        {!data.otcHistory.length ? <Empty title="No OTC trades yet" /> : (
          <ul className="divide-y divide-line">
            {data.otcHistory.map((t) => (
              <li key={t.txSignature}>
                <Link href={`/trade/${t.txSignature}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-hover/60">
                  <span className={t.seller === data.wallet ? "text-sell" : "text-buy"}>{t.seller === data.wallet ? "Sold" : "Bought"}</span>
                  <Tokens raw={t.tokenAmountRaw} decimals={t.decimals} symbol={t.symbol} />
                  <Sol lamports={t.grossQuoteLamports} digits={3} />
                  <span className="ml-auto text-[12px] text-muted">{t.blockTime ? relativeTime(t.blockTime) : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Tokens you created" />
        {!data.createdTokens.length ? <Empty title="You haven't launched a token" action={<Link href="/launch" className="text-glacier hover:underline">Launch one</Link>} /> : (
          <ul className="divide-y divide-line">
            {data.createdTokens.map((t) => (
              <li key={t.mint}>
                <Link href={`/token/${t.mint}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover/60">
                  <TokenAvatar src={t.imageUrl} symbol={t.symbol} size={24} />
                  <span>{t.symbol}</span>
                  <VenueBadge venue={t.venue} />
                  <span className="ml-auto text-[12px] text-muted">{relativeTime(t.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
