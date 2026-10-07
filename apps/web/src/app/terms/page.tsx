import { LegalPage } from "@/components/legal";
import { publicConfig } from "@/server/context";

export const metadata = { title: "Terms" };

export default function Terms() {
  const { appName } = publicConfig();
  return (
    <LegalPage title="Terms of use" updated="2026-10-07">
      <p>{appName} provides software that helps you create Pump.fun tokens, trade them on Pump and PumpSwap, and negotiate wallet-to-wallet OTC trades on Solana. By using it you agree to these terms.</p>
      <h2>Non-custodial software</h2>
      <p>You connect your own wallet and sign every message and transaction yourself. We never receive or store your private key or seed phrase, and we cannot move your assets. Anyone asking for your seed phrase is not us.</p>
      <h2>Your responsibilities</h2>
      <ul>
        <li>Review every transaction in your wallet before approving it.</li>
        <li>Verify OTC counterparties, token mint addresses and amounts yourself.</li>
        <li>Comply with the laws that apply to you, including any restrictions in your jurisdiction.</li>
      </ul>
      <h2>Third-party protocols</h2>
      <p>Launches and market trades execute on Pump.fun programs, which we do not operate or control. Their fees, rules and availability can change without notice.</p>
      <h2>Fees</h2>
      <p>OTC settlements may include a platform fee shown before you sign and included in the signed order. See the Fees page.</p>
      <h2>No warranty</h2>
      <p>The software is provided as is. We do not guarantee prices, availability, settlement, or the value of any asset.</p>
      <h2>Changes</h2>
      <p>We may update these terms. Material changes will be shown in the app before they take effect.</p>
    </LegalPage>
  );
}
