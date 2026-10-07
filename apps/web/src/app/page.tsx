import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { LiveMarkets, RecentTrades } from "@/components/home/live-sections";
import { publicConfig } from "@/server/context";

function LegsHero() {
  return (
    <figure aria-label="Example: one transaction carries both legs of an OTC trade" className="panel relative overflow-hidden p-6">
      <figcaption className="mb-5 text-[12px] text-faint">Example settlement</figcaption>
      <div className="space-y-3">
        <div className="leg-left flex items-center justify-between rounded-[var(--radius-control)] border border-brass/30 bg-brass-dim/40 px-4 py-3">
          <span className="text-[13px] text-muted">Seller sends</span>
          <span className="num text-[20px] text-brass">20,000,000 TOKEN</span>
        </div>
        <div className="leg-right flex items-center justify-between rounded-[var(--radius-control)] border border-glacier/30 bg-glacier-dim/40 px-4 py-3">
          <span className="text-[13px] text-muted">Buyer sends</span>
          <span className="num text-[20px] text-glacier">37 SOL</span>
        </div>
      </div>
      <svg viewBox="0 0 400 60" className="my-1 h-14 w-full" aria-hidden preserveAspectRatio="none">
        <path d="M60 0 C60 34, 200 26, 200 60" fill="none" stroke="var(--color-brass)" strokeWidth="2" className="leg-left" />
        <path d="M340 0 C340 34, 200 26, 200 60" fill="none" stroke="var(--color-glacier)" strokeWidth="2" className="leg-right" />
      </svg>
      <div className="leg-seal rounded-[var(--radius-control)] border border-line-strong bg-raised px-4 py-3">
        <p className="font-medium">One Solana transaction, signed by both wallets</p>
        <p className="mt-0.5 text-[13px] text-muted">Both legs settle together, or neither does. No escrow, no custody, no price impact on the curve.</p>
      </div>
    </figure>
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
  { q: "What if I cancel after the other side signed?", a: "Cancelling stops our app from collecting signatures or submitting. A transaction you already signed stays valid only until its blockhash expires, about 60 to 90 seconds." },
  { q: "Why use OTC instead of selling on Pump?", a: "Selling a large position into a bonding curve moves the price against you. A negotiated block trade settles at one agreed price. The comparison we show is an estimate, not a guarantee of either outcome." },
  { q: "Which tokens are supported?", a: "SOL-quoted Pump.fun tokens on the bonding curve or PumpSwap. Tokens with transfer hooks, permanent delegates, freeze authority or other risky Token-2022 extensions are refused." },
];

export default function Home() {
  const c = publicConfig();
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 pt-6 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h1 className="title-display text-[clamp(44px,7vw,84px)]">Launch on Pump. Trade size off-market.</h1>
          <p className="mt-5 max-w-[52ch] text-[17px] text-muted">Launch Pump.fun tokens and negotiate wallet-to-wallet block trades with atomic Solana settlement.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/otc" className={buttonClass({ size: "lg" })}>Open the OTC desk</Link>
            <Link href="/launch" className={buttonClass({ size: "lg", variant: "outline" })}>Launch a token</Link>
          </div>
          {!c.isMainnet && <p className="mt-6 text-[13px] text-warn">Running on Solana {c.cluster}. Tokens and SOL here have no real-world value.</p>}
        </div>
        <LegsHero />
      </section>

      <LiveMarkets />

      <section>
        <h2 className="title-display mb-6 text-[36px]">How an OTC trade works</h2>
        <ol className="grid gap-px overflow-hidden rounded-[var(--radius-panel)] border border-line bg-line md:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="bg-panel p-5">
              <span className="num text-[13px] text-faint">Step {i + 1}</span>
              <p className="mt-2 font-medium">{s.title}</p>
              <p className="mt-1 text-[13px] text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="panel p-6">
          <h2 className="title-display text-[30px]">Launch through Pump</h2>
          <p className="mt-2 text-muted">Create a Token-2022 coin with Pump's current create_v2 instruction, optionally with an atomic first buy. The mint key is generated in your browser and never sent to us.</p>
          <Link href="/launch" className={buttonClass({ variant: "outline", className: "mt-5" })}>Start a launch</Link>
        </div>
        <div className="panel p-6">
          <h2 className="title-display text-[30px]">Atomic settlement</h2>
          <p className="mt-2 text-muted">The token transfer, the SOL payment and the disclosed platform fee travel in a single transaction. Solana executes all of it or none of it.</p>
          <Link href="/docs#settlement" className={buttonClass({ variant: "outline", className: "mt-5" })}>Read the protocol</Link>
        </div>
      </section>

      <RecentTrades />

      <section className="grid gap-8 md:grid-cols-[1fr_1.4fr]">
        <h2 className="title-display text-[36px]">Questions</h2>
        <div className="divide-y divide-line border-y border-line">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="cursor-pointer list-none font-medium marker:hidden">{f.q}</summary>
              <p className="mt-2 max-w-prose text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-warn/30 bg-warn-dim/30 p-6">
        <h2 className="font-semibold text-warn">Risk disclosure</h2>
        <p className="mt-2 max-w-prose text-[13px] text-muted">
          Crypto assets can be extremely volatile and can go to zero. You control your own wallet and are responsible for every transaction you sign. Market prices change constantly and displayed quotes can be stale. Reference prices are estimates, not executable values. OTC counterparties should verify all terms before signing. {c.appName} does not guarantee the value of any asset and does not provide investment advice. <Link href="/risk" className="text-text underline">Full risk disclosure</Link>
        </p>
      </section>
    </div>
  );
}
