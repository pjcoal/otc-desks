import { ContractAddressLine } from "@/components/ui/contract-address";

/** Small print on the desktop, above the taskbar. Legal documents live in Start → Documents. */
export function Footer({ appName, platformTokenMint, appSymbol }: { appName: string; platformTokenMint: string | null; appSymbol: string }) {
  return (
    <footer className="mx-auto max-w-[1400px] px-3 pb-14 text-[13px] text-white [text-shadow:1px_1px_0_#1a1915]">
      {platformTokenMint && <ContractAddressLine mint={platformTokenMint} symbol={appSymbol} />}
      {appName} is non-custodial software. You sign every transaction in your own wallet. Crypto assets are highly volatile, quotes go stale, and nothing here is investment advice.
    </footer>
  );
}
