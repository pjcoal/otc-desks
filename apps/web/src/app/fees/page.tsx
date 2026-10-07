import { LegalPage } from "@/components/legal";
import { publicConfig } from "@/server/context";

export const metadata = { title: "Fees" };

export default function Fees() {
  const c = publicConfig();
  const mode = c.feeMode === "SELLER_PAYS" ? "deducted from the seller's proceeds" : c.feeMode === "BUYER_PAYS" ? "added to the buyer's payment" : "split equally between buyer and seller";
  return (
    <LegalPage title="Fees" updated="2026-10-07">
      <h2>OTC settlement</h2>
      <p>The current platform fee is {c.platformFeeBps / 100}% of the agreed price, {mode}. The fee rate and mode are part of the order you sign, are shown before every signature, and can never exceed what was signed. It is paid in SOL inside the settlement transaction to the published treasury wallet{c.treasuryWallet ? ` ${c.treasuryWallet}` : ""}.</p>
      {c.referralShareBps > 0 && <p>If the fee-paying wallet was referred, {c.referralShareBps / 100}% of the platform fee goes to the referrer in the same transaction. This comes out of the platform fee and never increases what you pay.</p>}
      <h2>Pump and PumpSwap trades</h2>
      <p>Buying or selling through Pump or PumpSwap pays the protocol's own fees (protocol, creator, and LP fees after graduation). We add nothing on top. Each quote shows the fees read from Pump's current on-chain fee schedule.</p>
      <h2>Network fees</h2>
      <p>Solana charges a small network fee per signature, plus rent for new token accounts. For OTC settlements, the buyer pays the network fee.</p>
      <h2>Token-2022 transfer fees</h2>
      <p>Some tokens charge a transfer fee in tokens. When that applies, settlement shows the gross amount, the token fee, and the net amount the buyer receives.</p>
    </LegalPage>
  );
}
