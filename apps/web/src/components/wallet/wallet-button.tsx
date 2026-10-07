"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DropdownMenu } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Sol } from "@/components/ui/amount";
import { useAuth } from "@/components/providers/auth";
import { shortAddress } from "@/lib/format";

const INSTALL = [
  { name: "Phantom", url: "https://phantom.com/download" },
  { name: "Solflare", url: "https://solflare.com/download" },
  { name: "Backpack", url: "https://backpack.app/downloads" },
];

export function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { wallets, select, connect } = useWallet();
  const detected = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Connect a wallet" description="Your wallet signs everything. This site never sees your private key or seed phrase.">
      <div className="space-y-2">
        {detected.length === 0 && <p className="text-muted">No Solana wallet detected in this browser.</p>}
        {detected.map((w) => (
          <button
            key={w.adapter.name}
            className="flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-line px-3 py-2.5 text-left hover:bg-hover"
            onClick={async () => {
              select(w.adapter.name);
              onOpenChange(false);
              try {
                await connect();
              } catch {
                // the provider's onError toast reports it
              }
            }}
          >
            <img src={w.adapter.icon} alt="" className="size-6 rounded" />
            <span className="font-medium">{w.adapter.name}</span>
            <span className="ml-auto text-[12px] text-faint">Detected</span>
          </button>
        ))}
        <div className="pt-3">
          <p className="mb-2 text-[13px] text-muted">Install a wallet</p>
          <div className="flex flex-wrap gap-2">
            {INSTALL.filter((i) => !detected.some((d) => d.adapter.name.startsWith(i.name))).map((i) => (
              <a key={i.name} href={i.url} target="_blank" rel="noreferrer noopener" className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-[13px] hover:bg-hover">
                {i.name}
              </a>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export function WalletButton() {
  const { publicKey, disconnect, wallet: active } = useWallet();
  const { connection } = useConnection();
  const { status, signIn, signOut, signingIn, session } = useAuth();
  const [open, setOpen] = useState(false);
  const addr = publicKey?.toBase58();
  const { data: balance } = useQuery({ queryKey: ["balance", addr], queryFn: () => connection.getBalance(publicKey!), enabled: !!publicKey, refetchInterval: 30_000 });

  if (!publicKey) {
    return (
      <>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Wallet className="size-4" /> Connect wallet
        </Button>
        <ConnectDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }
  if (status === "signed-out") {
    return (
      <Button size="sm" onClick={() => void signIn()} loading={signingIn}>
        Sign in as {shortAddress(addr!)}
      </Button>
    );
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex h-8 items-center gap-2 rounded-[var(--radius-control)] border border-line px-2.5 text-[13px] hover:bg-hover">
          {active && (
            <img src={active.adapter.icon} alt="" className="size-4 rounded-sm" />
          )}
          <span className="font-mono">{shortAddress(addr!)}</span>
          {balance !== undefined && <Sol lamports={BigInt(balance)} digits={2} className="hidden text-[12px] sm:inline" />}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="panel z-50 min-w-48 p-1 shadow-xl">
          <DropdownMenu.Item asChild>
            <Link href="/portfolio" className="block rounded px-3 py-2 outline-none hover:bg-hover data-[highlighted]:bg-hover">Portfolio</Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href={`/wallet/${addr}`} className="block rounded px-3 py-2 outline-none hover:bg-hover data-[highlighted]:bg-hover">Public profile</Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href="/settings" className="block rounded px-3 py-2 outline-none hover:bg-hover data-[highlighted]:bg-hover">Settings</Link>
          </DropdownMenu.Item>
          {session?.isAdmin && (
            <DropdownMenu.Item asChild>
              <Link href="/admin" className="block rounded px-3 py-2 outline-none hover:bg-hover data-[highlighted]:bg-hover">Operations</Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            onSelect={async () => {
              await signOut();
              await disconnect();
            }}
            className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-muted outline-none data-[highlighted]:bg-hover data-[highlighted]:text-text"
          >
            <LogOut className="size-4" /> Sign out and disconnect
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
