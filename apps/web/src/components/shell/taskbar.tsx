"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DropdownMenu } from "radix-ui";
import { useConfig } from "@/components/providers/config";
import { PixelIcon } from "@/components/ui/pixel-icon";
import { WalletButton } from "@/components/wallet/wallet-button";
import { NetworkBadge } from "./network-badge";
import { Notifications } from "./notifications";
import { PROGRAMS, windowTitle } from "./sections";

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return <span className="num hidden w-12 text-right text-[13px] sm:inline">{now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : ""}</span>;
}

const LEGAL = [
  { href: "/fees", label: "Fees" },
  { href: "/risk", label: "Risk disclosure" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/listing-disclaimer", label: "Token listings" },
];

export function Taskbar() {
  const path = usePathname();
  const { appName } = useConfig();
  const current = path === "/" ? null : windowTitle(path);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex h-10 items-center gap-1.5 bg-panel px-1 [box-shadow:inset_0_1px_0_var(--color-bevel-hi),inset_0_2px_0_var(--color-bevel-mid)]">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="flex h-8 items-center gap-1.5 bg-panel px-2 font-semibold bevel-out data-[state=open]:bevel-in">
          <PixelIcon name="legs" size={18} />
          Start
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content side="top" align="start" sideOffset={4} className="panel z-50 flex min-w-60 shadow-[4px_4px_0_rgba(0,0,0,0.35)]">
            <div className="titlebar flex w-7 items-end justify-center pb-2">
              <span className="text-[13px] [writing-mode:vertical-rl] rotate-180">{appName}</span>
            </div>
            <div className="flex-1 py-1">
              {PROGRAMS.map((p) => (
                <DropdownMenu.Item key={p.href} asChild>
                  <Link href={p.href} className="flex items-center gap-3 px-3 py-1.5 outline-none data-[highlighted]:bg-select data-[highlighted]:text-white">
                    <PixelIcon name={p.icon} size={22} />
                    {p.label}
                  </Link>
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Item asChild>
                <Link href="/otc/create" className="flex items-center gap-3 px-3 py-1.5 outline-none data-[highlighted]:bg-select data-[highlighted]:text-white">
                  <PixelIcon name="ticket" size={22} />
                  New OTC offer
                </Link>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="mx-2 my-1 h-0.5 [box-shadow:inset_0_1px_0_var(--color-bevel-lo),inset_0_-1px_0_var(--color-bevel-hi)]" />
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="flex items-center gap-3 px-3 py-1.5 outline-none data-[highlighted]:bg-select data-[highlighted]:text-white data-[state=open]:bg-select data-[state=open]:text-white">
                  <PixelIcon name="folder" size={22} />
                  <span className="flex-1">Documents</span>▸
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent className="panel z-50 min-w-44 py-1 shadow-[4px_4px_0_rgba(0,0,0,0.35)]">
                    {LEGAL.map((l) => (
                      <DropdownMenu.Item key={l.href} asChild>
                        <Link href={l.href} className="block px-3 py-1.5 outline-none data-[highlighted]:bg-select data-[highlighted]:text-white">
                          {l.label}
                        </Link>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
              <DropdownMenu.Item asChild>
                <Link href="/" className="flex items-center gap-3 px-3 py-1.5 outline-none data-[highlighted]:bg-select data-[highlighted]:text-white">
                  <PixelIcon name="legs" size={22} />
                  Show desktop
                </Link>
              </DropdownMenu.Item>
            </div>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <div className="mx-1 h-7 w-0.5 [box-shadow:inset_1px_0_0_var(--color-bevel-lo),inset_-1px_0_0_var(--color-bevel-hi)]" aria-hidden />
      {current && (
        <span className="hidden h-8 min-w-0 max-w-56 items-center gap-1.5 truncate bg-hover px-2 text-[14px] font-semibold bevel-in sm:flex">
          <PixelIcon name={current.icon} size={16} />
          <span className="truncate">{current.title}</span>
        </span>
      )}
      <div className="ml-auto flex h-8 items-center gap-1.5 px-2 bevel-in">
        <NetworkBadge />
        <Notifications />
        <WalletButton />
        <Clock />
      </div>
    </div>
  );
}

