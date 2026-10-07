import { LegalPage } from "@/components/legal";
import { publicConfig } from "@/server/context";

export const metadata = { title: "Privacy" };

export default function Privacy() {
  const { appName } = publicConfig();
  return (
    <LegalPage title="Privacy" updated="2026-10-07">
      <p>{appName} is built so that a wallet address is the only identity it needs.</p>
      <h2>What we store</h2>
      <ul>
        <li>Your wallet address and a hashed session token while you are signed in.</li>
        <li>Orders, counteroffers and acceptances you sign, with their signatures.</li>
        <li>Settlement transactions and their status, plus notifications addressed to your wallet.</li>
        <li>IP address and user agent with sessions and audit records, for security and abuse prevention.</li>
        <li>A referral code cookie if you arrive through a referral link.</li>
      </ul>
      <h2>What is public</h2>
      <p>Everything on Solana is public. Settled trades, including private OTC deals, are visible on chain. Within this app, private offers and negotiations are shown only to their two parties.</p>
      <h2>What we never collect</h2>
      <p>Private keys, seed phrases, or anything that would let us sign for you.</p>
      <h2>Third parties</h2>
      <p>Solana RPC providers process your requests; token images load from the hosts their creators chose. Requests to those hosts reveal your IP address to them.</p>
    </LegalPage>
  );
}
