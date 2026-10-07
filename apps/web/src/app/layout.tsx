import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Instrument_Serif, Schibsted_Grotesk } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/providers/app-providers";
import { Header } from "@/components/shell/header";
import { Footer } from "@/components/shell/footer";
import { publicConfig } from "@/server/context";
import "./globals.css";

const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted", display: "swap" });
const display = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-instrument", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const c = publicConfig();
  return { title: { default: `${c.appName}: launch on Pump, trade size off-market`, template: `%s | ${c.appName}` }, description: "Launch Pump.fun tokens and negotiate wallet-to-wallet block trades with atomic Solana settlement.", icons: { icon: "/icon.svg" } };
}

export const viewport: Viewport = { themeColor: "#0e1320", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  await headers(); // per-request rendering so the CSP nonce from proxy.ts is applied to Next's scripts
  const config = publicConfig();
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <AppProviders config={config}>
          <Header />
          <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
          <Footer appName={config.appName} />
        </AppProviders>
      </body>
    </html>
  );
}
