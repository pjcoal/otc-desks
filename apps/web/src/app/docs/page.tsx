import Link from "next/link";
import { publicConfig } from "@/server/context";

export const metadata = { title: "Docs" };

export default function Docs() {
  const c = publicConfig();
  return (
    <article className="memo mx-auto max-w-[80ch] space-y-4 bg-ink px-6 py-6 bevel-in sm:px-10 [&_h2]:mt-10 [&_h2]:text-[17px] [&_h2]:font-medium [&_h2]:uppercase [&_h3]:mt-5 [&_h3]:font-medium [&_li]:ml-5 [&_li]:list-disc [&_li]:text-muted [&_p]:text-muted [&_code]:bg-hover [&_code]:px-1 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-text">
      <h1 className="text-[22px] font-medium">How {c.appName} works</h1>
      <p>A guide for traders, plus enough protocol detail to verify everything yourself. Engineers implementing a compatible client should read <code>docs/otc-protocol.md</code> in the repository.</p>

      <h2 id="otc">OTC orders are signed messages</h2>
      <p>Posting an ask or bid asks your wallet to sign a human-readable message, not a transaction. The message lists every term: side, token mint, raw token amount and decimals, total SOL in lamports, counterparty, partial-fill rules, platform fee, expiry, a random nonce and salt, and the network and domain it is valid for. Its last line is the order hash: the SHA-256 of the order&apos;s canonical JSON.</p>
      <p>Because the message is derived deterministically from the order, anyone can rebuild it and check the signature. The order page does this in your browser and shows whether the maker signature verifies.</p>

      <h3>Counteroffers</h3>
      <p>A counter is a brand-new signed order for the opposite side, addressed to the other party and bound to the previous order&apos;s hash. Nothing earlier is ever edited. Only the newest revision in a negotiation can be accepted or countered.</p>

      <h3>Cancelling</h3>
      <p>Cancelling is another signed message. After it, the app refuses to collect signatures for or submit that order. A settlement transaction you already signed stays valid on Solana until its blockhash expires, typically 60–90 seconds.</p>

      <h2 id="settlement">Atomic settlement</h2>
      <p>When terms are accepted, the server re-checks both wallets (the seller still holds the tokens, the buyer still has enough SOL, the token has no unsafe Token-2022 extensions) and builds one Solana transaction containing, in order:</p>
      <ul>
        <li>compute budget instructions,</li>
        <li>creation of the buyer&apos;s token account if needed (paid by the buyer),</li>
        <li>a memo <code>otc-settlement:v1:&lt;order hash&gt;:&lt;settlement id&gt;</code>,</li>
        <li>the token transfer from the seller to the buyer (<code>TransferChecked</code>, or <code>TransferCheckedWithFee</code> for transfer-fee tokens),</li>
        <li>SOL transfers from the buyer to the seller, to the platform treasury, and to a referrer if any.</li>
      </ul>
      <p>Solana executes a transaction entirely or not at all, so neither leg can settle without the other. The buyer pays the network fee and signs first; the seller signs second; then it is submitted.</p>
      <h3>What your browser checks before you sign</h3>
      <ul>
        <li>The transaction uses only the System, Token, Token-2022, Associated Token Account, Memo and Compute Budget programs, with no address lookup tables.</li>
        <li>Exactly two signers, buyer then seller, matching the signed order.</li>
        <li>Token mint, program, decimals and amount match the order and fill; SOL to the seller equals the signed price minus the disclosed fee; the fee goes to the published treasury and never exceeds the signed rate.</li>
        <li>The bytes equal the canonical settlement rebuilt from those terms.</li>
      </ul>
      <p>The server stores the exact message bytes and only accepts signatures over those bytes. If a wallet or anyone else alters the transaction, the signature no longer matches and both parties must sign again.</p>
      <h3>If time runs out</h3>
      <p>If the blockhash expires before both signatures arrive, the settlement is retired only once it can no longer land, and a fresh one is built. Both parties sign again; old signatures can&apos;t be reused.</p>

      <h2 id="verify">Verifying a trade</h2>
      <p>Every receipt at <code>/trade/&lt;signature&gt;</code> is rebuilt from the chain: we decode the landed transaction, check its message hash against the agreed one, and read balances from the transaction itself. You can repeat this in any explorer.</p>

      <h2 id="pump">Pump.fun integration</h2>
      <p>Launches use Pump&apos;s <code>create_v2</code> instruction (Token-2022 mints). Buys on the bonding curve use <code>buy_exact_quote_in_v2</code> (exact SOL in, minimum tokens out); sells use <code>sell_v2</code>. Graduated tokens trade on PumpSwap. Market venue is detected automatically from on-chain state. Only SOL-quoted markets are supported.</p>

      <h2 id="fees">Fees</h2>
      <p>See <Link href="/fees" className="text-glacier underline">Fees</Link>. The platform fee is {c.platformFeeBps / 100}% on OTC settlements and nothing on Pump trades.</p>

      <h2 id="api">API</h2>
      <p>All endpoints are JSON under <code>/api</code>; mutating calls require a signed-in session cookie and a same-origin request. Highlights: <code>POST /api/auth/nonce</code>, <code>POST /api/auth/verify</code>, <code>GET /api/tokens/:mint</code>, <code>GET /api/quotes/buy</code>, <code>POST /api/otc/orders</code>, <code>POST /api/otc/orders/:id/counter</code>, <code>POST /api/otc/orders/:id/accept</code>, <code>POST /api/otc/settlement/prepare</code>, <code>POST /api/otc/settlement/partial-signature</code>, <code>GET /api/receipts/:signature</code>.</p>
    </article>
  );
}
