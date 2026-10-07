import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Panel, TitleBar } from "@/components/ui/panel";
import { PixelIcon, type PixelIconName } from "@/components/ui/pixel-icon";
import { LiveMarkets, RecentTrades } from "@/components/home/live-sections";
import { publicConfig } from "@/server/context";

const DESKTOP_ICONS: Array<{ href: string; label: string; icon: PixelIconName }> = [
  { href: "/explore", label: "Explore", icon: "explore" },
  { href: "/otc", label: "OTC Desk", icon: "ticket" },
  { href: "/launch", label: "Launch", icon: "rocket" },
  { href: "/portfolio", label: "Portfolio", icon: "briefcase" },
  { href: "/docs", label: "Help", icon: "help" },
];

function DesktopIcons() {
  return (
    <nav aria-label="Desktop" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-4 lg:overflow-visible">
      {DESKTOP_ICONS.map((i) => (
        <Link key={i.href} href={i.href} className="group flex w-20 shrink-0 flex-col items-center gap-1 p-1 text-center focus-visible:outline-white">
          <PixelIcon name={i.icon} size={40} />
          <span className="px-1 text-[13px] text-white [text-shadow:1px_1px_0_#1a1915] group-hover:bg-select group-focus-visible:bg-select">{i.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function SettlementDialog() {
  return (
    <Panel className="shadow-[4px_4px_0_rgba(0,0,0,0.3)]" aria-label="How one transaction carries both legs of an OTC trade">
      <TitleBar title="Settlement.dlg" icon={<PixelIcon name="ticket" size={16} />} />
      <div className="space-y-2 p-4">
        <div className="leg-left flex items-center justify-between gap-4 bg-ink px-3 py-2 bevel-in">
          <span className="text-muted">Seller sends</span>
          <span className="text-right text-[18px] text-brass">the agreed tokens</span>
        </div>
        <div className="leg-right flex items-center justify-between gap-4 bg-ink px-3 py-2 bevel-in">
          <span className="text-muted">Buyer sends</span>
          <span className="text-right text-[18px] text-glacier">the agreed SOL</span>
        </div>
        <div className="leg-seal flex items-start gap-3 pt-2">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center border border-text bg-buy text-[14px] font-bold text-white" aria-hidden>
            ✓
          </span>
          <p className="text-[14px]">
            <span className="font-semibold">One Solana transaction, signed by both wallets.</span> Both legs settle together, or neither does. No escrow, no custody, no price impact on the curve.
          </p>
        </div>
      </div>
    </Panel>
  );
}

const STEPS = [
  { title: "Post a signed offer", body: "Sign an ask or bid in your wallet. It's a free message, not a transaction, and your assets never leave your wallet." },
  { title: "Negotiate", body: "Counterparties accept or counter. Every counter is a new signed order; nothing earlier is ever edited." },
  { title: "Both sign one transaction", body: "We build the settlement, re-check both balances, and each wallet verifies the exact bytes before signing." },
  { title: "Verify the receipt", body: "Every settlement is checked against the chain and anyone can confirm it on a block explorer." },
];

const FAQ = [
  { q: "Do you ever hold my tokens or SOL?", a: "No. Orders are signed messages. Assets move only inside the settlement transaction that both wallets sign, directly from one wallet to the other." },
  { q: "What stops someone changing the deal after I sign?", a: "Your signature covers the exact transaction bytes: amounts, recipients, token mint and fee. Any change invalidates it, and your browser re-verifies the transaction against the signed order before asking your wallet." },
  { q: "What if I cancel after the other side signed?", a: "Cancelling stops this app from collecting signatures or submitting. A transaction you already signed stays valid only until its blockhash expires, about 60 to 90 seconds." },
  { q: "Why use OTC instead of selling on Pump?", a: "Selling a large position into a bonding curve moves the price against you. A negotiated block trade settles at one agreed price. The comparison we show is an estimate, not a guarantee of either outcome." },
  { q: "Which tokens are supported?", a: "SOL-quoted Pump.fun tokens on the bonding curve or PumpSwap. Tokens with transfer hooks, permanent delegates, freeze authority or other risky Token-2022 extensions are refused." },
];

export default function Home() {
  const c = publicConfig();
  return (
    <div className="mx-auto grid max-w-[1400px] gap-4 lg:grid-cols-[96px_minmax(0,1fr)]">
      <DesktopIcons />
      <div className="min-w-0 space-y-4">
        <div className="grid items-start gap-4 xl:grid-cols-[1.15fr_1fr]">
          <Panel className="shadow-[4px_4px_0_rgba(0,0,0,0.3)]">
            <TitleBar title={`Welcome to ${c.appName}`} icon={<PixelIcon name="legs" size={16} />} />
            <div className="p-5 sm:p-7">
              <h1 className="title-display text-[clamp(36px,6vw,64px)]">Launch on Pump. Trade size off-market.</h1>
              <p className="mt-4 max-w-[52ch] text-[17px] text-muted">Launch Pump.fun tokens and negotiate wallet-to-wallet block trades with atomic Solana settlement.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link href="/otc" className={buttonClass({ size: "lg", variant: "primary" })}>Open the OTC desk</Link>
                <Link href="/launch" className={buttonClass({ size: "lg" })}>Launch a token</Link>
              </div>
              {!c.isMainnet && <p className="mt-5 text-[14px] text-warn">Running on Solana {c.cluster}. Tokens and SOL here have no real-world value.</p>}
              {c.isMainnet && !c.transactionsEnabled && <p className="mt-5 text-[14px] text-sell">Mainnet, read-only: browsing and quotes work; trading is switched off on this deployment.</p>}
            </div>
          </Panel>
          <SettlementDialog />
        </div>

        <LiveMarkets />

        <Panel>
          <TitleBar title="How an OTC trade works" icon={<PixelIcon name="help" size={16} />} />
          <ol className="grid gap-3 p-4 md:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="bg-ink p-3 bevel-in">
                <span className="num text-[13px] text-faint">Step {i + 1} of 4</span>
                <p className="mt-1 font-semibold">{s.title}</p>
                <p className="mt-1 text-[14px] text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </Panel>

        <div className="grid gap-4 md:grid-cols-2">
          <Panel>
            <TitleBar title="Launch through Pump" icon={<PixelIcon name="rocket" size={16} />} />
            <div className="p-4">
              <p className="text-muted">Create a Token-2022 coin with Pump&apos;s current create_v2 instruction, optionally with an atomic first buy. The mint key is generated in your browser and never sent to us.</p>
              <Link href="/launch" className={buttonClass({ className: "mt-4" })}>Start a launch</Link>
            </div>
          </Panel>
          <Panel>
            <TitleBar title="Atomic settlement" icon={<PixelIcon name="ticket" size={16} />} />
            <div className="p-4">
              <p className="text-muted">The token transfer, the SOL payment and the disclosed platform fee travel in a single transaction. Solana executes all of it or none of it.</p>
              <Link href="/docs#settlement" className={buttonClass({ className: "mt-4" })}>Read the protocol</Link>
            </div>
          </Panel>
        </div>

        <RecentTrades />

        <Panel>
          <TitleBar title="Help - Questions" icon={<PixelIcon name="help" size={16} />} />
          <div className="m-3 divide-y divide-line bg-ink bevel-in">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold marker:hidden">
                  <span className="flex size-4 items-center justify-center bg-panel text-[13px] leading-none bevel-out group-open:bevel-in" aria-hidden>
                    <span className="group-open:hidden">+</span>
                    <span className="hidden group-open:inline">−</span>
                  </span>
                  {f.q}
                </summary>
                <p className="mt-2 max-w-prose pl-6 text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </Panel>

        <Panel>
          <TitleBar title="Risk disclosure" />
          <div className="flex items-start gap-4 p-4">
            <svg width="36" height="32" viewBox="0 0 12 11" shapeRendering="crispEdges" aria-hidden className="shrink-0">
              <path fill="#1a1915" d="M5 0h2v1H5zM4 1h1v2H4zM7 1h1v2H7zM3 3h1v2H3zM8 3h1v2H8zM2 5h1v2H2zM9 5h1v2H9zM1 7h1v2H1zM10 7h1v2h-1zM0 9h1v2H0zM11 9h1v2h-1zM1 10h10v1H1z" />
              <path fill="#e8c25a" d="M5 1h2v2H5zM4 3h4v2H4zM3 5h6v2H3zM2 7h8v2H2zM1 9h10v1H1z" />
              <path fill="#1a1915" d="M5.5 3.5h1v3h-1zM5.5 7.5h1v1h-1z" />
            </svg>
            <p className="max-w-prose text-[14px] text-muted">
              Crypto assets can be extremely volatile and can go to zero. You control your own wallet and are responsible for every transaction you sign. Market prices change constantly and displayed quotes can be stale. Reference prices are estimates, not executable values. OTC counterparties should verify all terms before signing. {c.appName} does not guarantee the value of any asset and does not provide investment advice.{" "}
              <Link href="/risk" className="text-glacier underline">Full risk disclosure</Link>
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
