import { LegalPage } from "@/components/legal";
import { publicConfig } from "@/server/context";

export const metadata = { title: "Risk disclosure" };

export default function Risk() {
  const { appName } = publicConfig();
  return (
    <LegalPage title="Risk disclosure" updated="2026-10-07">
      <ul>
        <li>Crypto assets, and newly launched memecoins in particular, can be extremely volatile and can lose all of their value.</li>
        <li>You control your own wallet. Transactions you sign are final and cannot be reversed by {appName} or anyone else.</li>
        <li>Market prices change constantly. Quotes, reference prices and market comparisons are estimates that can be stale by the time you act; reference prices are not executable values.</li>
        <li>OTC counterparties are other users. Verify every term, including the token mint, before signing. An order signature alone moves no funds, but a settlement transaction you sign will execute exactly as shown.</li>
        <li>A transaction you have already co-signed remains valid until its blockhash expires (about 60–90 seconds), even if you cancel the order in the app.</li>
        <li>Token names and images are chosen by creators and can impersonate other projects. The mint address is the only reliable identifier.</li>
        <li>Pump.fun protocol rules, fees and availability are outside our control and may change.</li>
        <li>Smart contracts, wallets and RPC providers can fail or be attacked.</li>
        <li>{appName} does not guarantee the value of any asset and does not provide financial, investment, tax or legal advice.</li>
      </ul>
    </LegalPage>
  );
}
