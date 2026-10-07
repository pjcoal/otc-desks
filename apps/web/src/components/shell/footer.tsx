import Link from "next/link";

export function Footer({ appName }: { appName: string }) {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-8 text-[13px] text-muted md:grid-cols-[1fr_auto]">
        <p className="max-w-prose">
          {appName} is non-custodial software. You keep control of your wallet and sign every transaction yourself. Crypto assets are highly volatile, quotes go stale quickly, and nothing here is
          investment advice. Verify every OTC counterparty and term before you sign.
        </p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/docs" className="hover:text-text">Docs</Link>
          <Link href="/fees" className="hover:text-text">Fees</Link>
          <Link href="/risk" className="hover:text-text">Risk disclosure</Link>
          <Link href="/terms" className="hover:text-text">Terms</Link>
          <Link href="/privacy" className="hover:text-text">Privacy</Link>
          <Link href="/listing-disclaimer" className="hover:text-text">Token listings</Link>
        </nav>
      </div>
    </footer>
  );
}
