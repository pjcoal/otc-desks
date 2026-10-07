"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useConfig } from "@/components/providers/config";
import { PixelIcon } from "@/components/ui/pixel-icon";
import { WindowGlyphs } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { PROGRAMS, windowTitle } from "./sections";
import { Search } from "./search";

/**
 * Every page except the desktop (/) opens maximized in one program window: title bar, a menu bar of
 * real links, then the page. Panels inside render as child windows.
 */
export function AppWindow({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { appName } = useConfig();
  if (path === "/") return <>{children}</>;
  const { title, icon } = windowTitle(path);
  return (
    <div className="panel mx-auto max-w-[1400px] shadow-[4px_4px_0_rgba(0,0,0,0.3)]">
      <div className="titlebar flex h-8 items-center gap-2 px-2">
        <PixelIcon name={icon} size={18} />
        <h1 className="min-w-0 flex-1 truncate text-[15px]">
          {title} - {appName}
        </h1>
        <WindowGlyphs />
      </div>
      <nav className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-line px-1 py-1" aria-label="Main">
        {PROGRAMS.filter((p) => p.task).map((p) => (
          <Link key={p.href} href={p.href} className={cn("px-2 py-0.5 text-[14px]", path.startsWith(p.href) ? "bg-select text-white" : "hover:bg-select hover:text-white")}>
            {p.label}
          </Link>
        ))}
        <Link href="/docs" className={cn("px-2 py-0.5 text-[14px]", path.startsWith("/docs") ? "bg-select text-white" : "hover:bg-select hover:text-white")}>
          Help
        </Link>
        <div className="ml-auto w-full sm:w-72">
          <Search />
        </div>
      </nav>
      <div className="min-h-[60vh] p-2 sm:p-4">{children}</div>
    </div>
  );
}
