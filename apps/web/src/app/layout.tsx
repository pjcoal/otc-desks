import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Pixelify_Sans } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/providers/app-providers";
import { AppWindow } from "@/components/shell/app-window";
import { Footer } from "@/components/shell/footer";
import { Taskbar } from "@/components/shell/taskbar";
import { publicConfig } from "@/server/context";
import "./globals.css";

const pixel = Pixelify_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-pixel", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const c = publicConfig();
  return {
    title: { default: `${c.appName}: launch on Pump, trade size off-market`, template: `%s | ${c.appName}` }, description: "Launch Pump.fun tokens and negotiate wallet-to-wallet block trades with atomic Solana settlement.",
    icons: { icon: "/icon.svg" },
    openGraph: { title: c.appName, description: "Launch on Pump. Trade size off-market.", images: [{ url: "/brand/desk404-tile-512.png", width: 512, height: 512 }] },
    twitter: { card: "summary", title: c.appName, images: ["/brand/desk404-tile-512.png"] },
  };
}

export const viewport: Viewport = { themeColor: "#6b7f8c", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  await headers(); // per-request rendering so the CSP nonce from proxy.ts is applied to Next's scripts
  const config = publicConfig();
  return (
    <html lang="en" className={`${pixel.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <AppProviders config={config}>
          <main className="px-2 pb-16 pt-3 sm:px-4 sm:pt-4">
            <AppWindow>{children}</AppWindow>
          </main>
          <Footer appName={config.appName} platformTokenMint={config.platformTokenMint} appSymbol={config.appSymbol} />
          <Taskbar />
        </AppProviders>
      </body>
    </html>
  );
}
