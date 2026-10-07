"use client";
import { useQuery } from "@tanstack/react-query";
import { AtSign, Globe, Send, Share2, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { isBase58PublicKey, relativeTime } from "@app/shared";
import { api } from "@/lib/api";
import { bps, price, sol } from "@/lib/format";
import type { TokenDetail } from "@/lib/types";
import { useLiveMint } from "@/components/providers/live";
import { Address } from "@/components/ui/address";
import { Sol, Tokens } from "@/components/ui/amount";
import { Usd } from "@/components/ui/usd";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Panel, Row } from "@/components/ui/panel";
import { Empty, ErrorNote, Skeleton } from "@/components/ui/skeleton";
import { VenueBadge } from "@/components/ui/status";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { toast } from "@/components/ui/toast";
import { OtcBook } from "@/components/token/otc-book";
import { PriceChart } from "@/components/token/price-chart";
import { TradePanel } from "@/components/token/trade-panel";

interface MarketTrade {
  signature: string;
  side: "BUY" | "SELL";
  trader: string;
  solAmount: string;
  tokenAmount: string;
  priceSolPerToken: string;
  venue: string;
  blockTime: string;
  commitment: string;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="num mt-0.5 truncate text-[15px] font-medium">{children}</dd>
    </div>
  );
}

export function TokenView({ mint }: { mint: string }) {
  const valid = isBase58PublicKey(mint);
  useLiveMint(valid ? mint : null);
  const { data, error, isLoading } = useQuery({ queryKey: ["token", mint], queryFn: () => api<TokenDetail>(`/api/tokens/${mint}`), enabled: valid, refetchInterval: 20_000 });
  const trades = useQuery({ queryKey: ["trades", mint], queryFn: () => api<{ market: MarketTrade[] }>(`/api/tokens/${mint}/trades`), enabled: valid, refetchInterval: 20_000 });
  const holders = useQuery({ queryKey: ["holders", mint], queryFn: () => api<{ holders: Array<{ address: string; amountRaw: string }> }>(`/api/tokens/${mint}/holders`), enabled: valid });

  if (!valid) return <ErrorNote error="That is not a valid Solana mint address." />;
  if (error) return <ErrorNote error={error} />;
  if (isLoading || !data)
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Skeleton className="h-[520px]" />
        <Skeleton className="h-[520px]" />
      </div>
    );

  const { token, market, metadata, safety, stats } = data;
  const curve = market.bondingCurve;
  const pool = market.pool;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <Panel className="p-4">
          <div className="flex flex-wrap items-start gap-4">
            <TokenAvatar mint={token.mint} src={token.imageUrl} symbol={token.symbol} size={56} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="title-display text-[24px] sm:text-[30px]">{token.name}</h1>
                <span className="text-lg text-muted">{token.symbol}</span>
                <VenueBadge venue={market.venue} />
                {token.launchedViaPlatform && <Badge tone="outline">Launched here</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
                <span className="flex items-center gap-1">Mint <Address value={mint} chars={6} /></span>
                {token.creator && <span className="flex items-center gap-1">Creator <Address value={token.creator} profile /></span>}
                <span>Created {relativeTime(token.createdAt)}</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(window.location.href);
                toast.success("Link copied");
              }}
            >
              <Share2 className="size-4" /> Share
            </Button>
          </div>
          {metadata?.uri && !metadata.verifiedOnChain && <p className="mt-3 text-[13px] text-warn">Off-chain metadata does not match the on-chain metadata URI. Names and images are set by the creator and can impersonate other tokens; always check the mint address.</p>}
          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-3 xl:grid-cols-6">
            <Stat label="Price">{price(market.priceSolPerToken)} SOL</Stat>
            <Stat label="Market cap"><Usd lamports={market.marketCapLamports} digits={1} /></Stat>
            <Stat label={market.venue === "PUMPSWAP" ? "Pool liquidity" : "SOL in curve"}><Sol lamports={market.liquidityLamports} digits={2} /></Stat>
            <Stat label="24h volume"><Usd usd={stats.volume24hUsd} lamports={stats.volume24hLamports} /></Stat>
            <Stat label="24h trades">{stats.trades24h}</Stat>
            <Stat label="Holders">{stats.holderCount ?? <span className="text-faint" title="Exact holder counts are not tracked">—</span>}</Stat>
          </dl>
          {market.venue === "PUMP_BONDING_CURVE" && market.progressBps !== null && (
            <div className="mt-4">
              <div className="mb-1.5 flex justify-between text-[13px] text-muted">
                <span>Bonding curve progress</span>
                <span className="num">{bps(market.progressBps)}</span>
              </div>
              <div className="h-5 bg-ink p-[3px] bevel-in" role="progressbar" aria-valuenow={market.progressBps / 100} aria-valuemin={0} aria-valuemax={100}>
                <div className="chunks h-full" style={{ width: `${market.progressBps / 100}%` }} />
              </div>
              <p className="mt-1.5 text-[13px] text-faint">When every curve token is sold the coin graduates and liquidity migrates to PumpSwap.</p>
            </div>
          )}
          {market.note && <p className="mt-3 text-[13px] text-warn">{market.note}</p>}
        </Panel>

        <Panel>
          <PriceChart mint={mint} />
        </Panel>

        <Panel>
          <Tabs defaultValue="otc">
            <TabsList className="px-2">
              <TabsTrigger value="market">Market</TabsTrigger>
              <TabsTrigger value="otc">OTC</TabsTrigger>
              <TabsTrigger value="trades">Trades</TabsTrigger>
              <TabsTrigger value="holders">Holders</TabsTrigger>
              <TabsTrigger value="about">About</TabsTrigger>
            </TabsList>
            <TabsContent value="market" className="p-4">
              <dl className="grid gap-x-8 text-[13px] md:grid-cols-2">
                <Row label="Venue"><VenueBadge venue={market.venue} /></Row>
                <Row label="Snapshot slot">{market.slot}</Row>
                <Row label="Token program">{market.tokenProgram.startsWith("Tokenz") ? "Token-2022" : "SPL Token"}</Row>
                <Row label="Supply"><Tokens raw={market.supply} decimals={market.decimals} /></Row>
                {curve && (
                  <>
                    <Row label="Virtual SOL reserves"><Sol lamports={String(curve.virtualSolReserves)} /></Row>
                    <Row label="Virtual token reserves"><Tokens raw={String(curve.virtualTokenReserves)} decimals={market.decimals} /></Row>
                    <Row label="Real SOL reserves"><Sol lamports={String(curve.realSolReserves)} /></Row>
                    <Row label="Tokens left on curve"><Tokens raw={String(curve.realTokenReserves)} decimals={market.decimals} /></Row>
                    <Row label="Curve account"><Address value={String(curve.address)} /></Row>
                    {curve.isHolderReward === true && <Row label="Creator fees">Paid to holders (holder-reward coin)</Row>}
                  </>
                )}
                {pool && (
                  <>
                    <Row label="Pool"><Address value={String(pool.address)} /></Row>
                    <Row label="Base reserve"><Tokens raw={String(pool.baseReserve)} decimals={market.decimals} /></Row>
                    <Row label="Quote reserve"><Sol lamports={String(pool.quoteReserve)} /></Row>
                    <Row label="Virtual quote reserve" hint="Signed; may be negative">{sol(String(pool.virtualQuoteReserves))} SOL</Row>
                  </>
                )}
              </dl>
            </TabsContent>
            <TabsContent value="otc">
              <OtcBook mint={mint} symbol={token.symbol} marketPrice={market.priceSolPerToken === "0" ? null : market.priceSolPerToken} marketAt={market.fetchedAt} />
            </TabsContent>
            <TabsContent value="trades">
              {!trades.data?.market.length ? (
                <Empty title="No indexed trades yet">Pump and PumpSwap trades appear here as the indexer sees them.</Empty>
              ) : (
                <div className="m-2 overflow-x-auto bg-ink bevel-in">
                  <table className="w-full min-w-[640px] text-[13px]">
                    <thead className="text-left text-[13px] text-text">
                      <tr>
                        <th className="px-4 py-2 bg-panel font-normal bevel-out">Side</th>
                        <th className="px-2 py-2 bg-panel font-normal bevel-out">SOL</th>
                        <th className="px-2 py-2 bg-panel font-normal bevel-out">Tokens</th>
                        <th className="px-2 py-2 bg-panel font-normal bevel-out">Price</th>
                        <th className="px-2 py-2 bg-panel font-normal bevel-out">Trader</th>
                        <th className="px-4 py-2 text-right bg-panel font-normal bevel-out">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.data.market.map((t) => (
                        <tr key={`${t.signature}`} className="border-b border-line/60">
                          <td className={`px-4 py-2 font-medium ${t.side === "BUY" ? "text-buy" : "text-sell"}`}>{t.side === "BUY" ? "Buy" : "Sell"}</td>
                          <td className="px-2 py-2"><Sol lamports={t.solAmount} digits={3} /></td>
                          <td className="px-2 py-2"><Tokens raw={t.tokenAmount} decimals={market.decimals} /></td>
                          <td className="num px-2 py-2">{price(t.priceSolPerToken)}</td>
                          <td className="px-2 py-2"><Address value={t.trader} profile /></td>
                          <td className="px-4 py-2 text-right text-muted">
                            <Address value={t.signature} kind="tx" className="justify-end" /> {relativeTime(t.blockTime)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
            <TabsContent value="holders" className="p-4">
              <p className="mb-3 text-[13px] text-faint">Largest token accounts on chain. Accounts can belong to the bonding curve, a pool, or an exchange.</p>
              <dl className="text-[13px]">
                {holders.data?.holders.map((h, i) => (
                  <Row key={h.address} label={<span className="flex items-center gap-2"><span className="num w-5 text-faint">{i + 1}</span><Address value={h.address} /></span>}>
                    <Tokens raw={h.amountRaw} decimals={market.decimals} />
                  </Row>
                ))}
              </dl>
            </TabsContent>
            <TabsContent value="about" className="space-y-4 p-4">
              {metadata?.description ? <p className="max-w-prose whitespace-pre-line text-muted">{metadata.description}</p> : <p className="text-muted">The creator did not add a description.</p>}
              <div className="flex flex-wrap gap-2">
                {metadata?.website && <a href={metadata.website} target="_blank" rel="noreferrer noopener nofollow" className={buttonClass({ variant: "outline", size: "sm" })}><Globe className="size-4" />Website</a>}
                {metadata?.twitter && <a href={metadata.twitter} target="_blank" rel="noreferrer noopener nofollow" className={buttonClass({ variant: "outline", size: "sm" })}><AtSign className="size-4" />X</a>}
                {metadata?.telegram && <a href={metadata.telegram} target="_blank" rel="noreferrer noopener nofollow" className={buttonClass({ variant: "outline", size: "sm" })}><Send className="size-4" />Telegram</a>}
              </div>
              <div className="rounded-[var(--radius-control)] border border-line p-3">
                <p className="flex items-center gap-2 font-medium">
                  {safety.ok ? <ShieldCheck className="size-4 text-buy" /> : <ShieldAlert className="size-4 text-sell" />}
                  {safety.ok ? "Eligible for OTC settlement" : "Not eligible for OTC settlement"}
                </p>
                <ul className="mt-2 space-y-1 text-[13px]">
                  {safety.blockers.map((b) => <li key={b} className="text-sell">{b}</li>)}
                  {safety.warnings.map((w) => <li key={w} className="text-warn">{w}</li>)}
                </ul>
                <dl className="mt-2 text-[13px]">
                  <Row label="Token-2022 extensions">{safety.extensions.length ? safety.extensions.join(", ") : "None"}</Row>
                  <Row label="Mint authority">{safety.mintAuthority ? <Address value={safety.mintAuthority} /> : "Revoked"}</Row>
                  <Row label="Freeze authority">{safety.freezeAuthority ? <Address value={safety.freezeAuthority} /> : "Revoked"}</Row>
                  {metadata?.uri && <Row label="Metadata URI"><span className="break-all text-[13px] text-muted">{metadata.uri}</span></Row>}
                </dl>
              </div>
              <p className="text-[13px] text-faint">Listing a token here is automatic and is not an endorsement. See the token listing disclaimer.</p>
            </TabsContent>
          </Tabs>
        </Panel>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <TradePanel market={market} symbol={token.symbol} />
        <Panel className="space-y-3 p-4">
          <p className="font-medium">Trading size?</p>
          <p className="text-[13px] text-muted">Selling a large position into the curve moves the price against you. Post a block offer instead and settle wallet-to-wallet in one atomic transaction.</p>
          <div className="grid grid-cols-2 gap-2">
            <Link href={`/otc/create?mint=${mint}&side=SELL`} className={buttonClass({ variant: "outline", size: "sm" })}>Make OTC offer</Link>
            <Link href={`/otc/create?mint=${mint}&side=BUY`} className={buttonClass({ variant: "outline", size: "sm" })}>Place OTC bid</Link>
          </div>
          {!safety.ok && <p className="text-[13px] text-sell">This token can't be settled OTC: {safety.blockers[0]}</p>}
        </Panel>
      </aside>
    </div>
  );
}
