"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConfig } from "@/components/providers/config";
import { WalletButton } from "@/components/wallet/wallet-button";
import { cn } from "@/lib/cn";
import { NetworkBadge } from "./network-badge";
import { Notifications } from "./notifications";
import { Search } from "./search";

const NAV = [
  { href: "/explore", label: "Explore" },
  { href: "/otc", label: "OTC desk" },
  { href: "/launch", label: "Launch" },
  { href: "/portfolio", label: "Portfolio" },
];

export function Header() {
  const { appName } = useConfig();
  const path = usePathname();
  const nav = NAV.map((n) => (
    <Link key={n.href} href={n.href} className={cn("whitespace-nowrap rounded-[var(--radius-control)] px-2.5 py-1.5 text-[13px] font-medium", path.startsWith(n.href) ? "text-text" : "text-muted hover:text-text")}>
      {n.label}
    </Link>
  ));
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={`${appName} home`}>
          <LegsMark />
          <span className="title-display hidden text-[22px] sm:inline">{appName}</span>
        </Link>
        <nav className="hidden items-center md:flex">{nav}</nav>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
          <div className="hidden flex-1 justify-end lg:flex">
            <Search />
          </div>
          <NetworkBadge />
          <Notifications />
          <WalletButton />
        </div>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto border-t border-line px-2 py-1 md:hidden">{nav}</div>
      <div className="border-t border-line px-4 py-2 lg:hidden">
        <Search />
      </div>
    </header>
  );
}

/** Two legs meeting in one line: the token leg (brass) and the SOL leg (glacier). */
export function LegsMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M3 6 H10 Q12 6 12 9 V12" fill="none" stroke="var(--color-brass)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M21 6 H14 Q12 6 12 9 V12" fill="none" stroke="var(--color-glacier)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12 12 V19" stroke="var(--color-text)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
