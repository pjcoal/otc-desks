import type { PixelIconName } from "@/components/ui/pixel-icon";

/** Every top-level "program" and the window title it opens with. */
export const PROGRAMS: Array<{ href: string; label: string; icon: PixelIconName; task?: boolean }> = [
  { href: "/explore", label: "Explore", icon: "explore", task: true },
  { href: "/otc", label: "OTC Desk", icon: "ticket", task: true },
  { href: "/launch", label: "Launch", icon: "rocket", task: true },
  { href: "/portfolio", label: "Portfolio", icon: "briefcase", task: true },
  { href: "/settings", label: "Control Panel", icon: "gear" },
  { href: "/docs", label: "Help", icon: "help" },
];

export function windowTitle(path: string): { title: string; icon: PixelIconName } {
  const p = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (p("/otc/create")) return { title: "OTC Desk - New offer", icon: "ticket" };
  if (p("/otc")) return { title: "OTC Desk", icon: "ticket" };
  if (p("/deal")) return { title: "OTC Desk - Deal", icon: "ticket" };
  if (p("/trade")) return { title: "Settlement receipt", icon: "ticket" };
  if (p("/token")) return { title: "Explore - Token", icon: "explore" };
  if (p("/explore")) return { title: "Explore", icon: "explore" };
  if (p("/launch")) return { title: "Launch", icon: "rocket" };
  if (p("/portfolio")) return { title: "Portfolio", icon: "briefcase" };
  if (p("/wallet")) return { title: "Wallet profile", icon: "briefcase" };
  if (p("/settings")) return { title: "Control Panel", icon: "gear" };
  if (p("/admin")) return { title: "Operations", icon: "gear" };
  if (p("/docs")) return { title: "Help", icon: "help" };
  for (const [prefix, file] of [["/terms", "TERMS.TXT"], ["/privacy", "PRIVACY.TXT"], ["/risk", "RISK.TXT"], ["/fees", "FEES.TXT"], ["/listing-disclaimer", "LISTINGS.TXT"]] as const) {
    if (p(prefix)) return { title: `Notepad - ${file}`, icon: "folder" };
  }
  return { title: "Untitled", icon: "folder" };
}
