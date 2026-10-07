import { LegalPage } from "@/components/legal";

export const metadata = { title: "Token listings" };

export default function ListingDisclaimer() {
  return (
    <LegalPage title="Token listing disclaimer" updated="2026-10-07">
      <p>Any token created on Pump.fun appears here automatically when our indexer sees it, or when someone looks up its mint. Appearing in this app is not an endorsement, a review, or a statement about the token&apos;s legitimacy or value.</p>
      <p>Names, tickers, images, descriptions and links are supplied by token creators. We display them as data and cannot verify them. Always identify a token by its mint address.</p>
      <p>Tokens with Token-2022 extensions that make simple transfers unsafe (transfer hooks, permanent delegates, freeze authority, pausing, confidential or non-transferable tokens) cannot be settled through the OTC desk.</p>
    </LegalPage>
  );
}
