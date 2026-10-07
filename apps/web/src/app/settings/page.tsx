"use client";
import { useState } from "react";
import { useAuth } from "@/components/providers/auth";
import { useConfig } from "@/components/providers/config";
import { useSettings } from "@/lib/settings";
import { bps } from "@/lib/format";
import { Address } from "@/components/ui/address";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader, Row } from "@/components/ui/panel";
import { SlippageControl } from "@/components/token/slippage";

export default function SettingsPage() {
  const cfg = useConfig();
  const { session, wallet, signOut, signIn, status } = useAuth();
  const { slippageBps, setSlippageBps } = useSettings();
  const [copied, setCopied] = useState(false);
  const refLink = session?.referralCode && typeof window !== "undefined" ? `${window.location.origin}/?ref=${session.referralCode}` : null;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="title-display text-[44px] leading-none">Settings</h1>
      <Panel>
        <PanelHeader title="Trading" />
        <dl className="p-4">
          <Row label="Default slippage" hint="Stored on this device. Every trade shows and lets you change it.">
            <span className="flex items-center gap-2">{bps(slippageBps)} <SlippageControl value={slippageBps} onChange={setSlippageBps} /></span>
          </Row>
        </dl>
      </Panel>
      <Panel>
        <PanelHeader title="Session" />
        <dl className="p-4">
          <Row label="Signed in as">{wallet ? <Address value={wallet} /> : "Not signed in"}</Row>
          {session?.expiresAt && <Row label="Session expires">{new Date(session.expiresAt).toLocaleString()}</Row>}
          <Row label="Network">{cfg.cluster}</Row>
        </dl>
        <div className="border-t border-line p-4">
          {status === "signed-in" ? <Button variant="outline" onClick={() => void signOut()}>Sign out on this device</Button> : <Button onClick={() => void signIn()}>Sign in</Button>}
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Referrals" />
        <div className="space-y-3 p-4 text-[13px]">
          {cfg.referralShareBps > 0 ? (
            <p className="text-muted">When a wallet you refer pays an OTC platform fee, {bps(cfg.referralShareBps)} of that fee is sent to your wallet inside the same settlement transaction. It never adds to what anyone pays.</p>
          ) : (
            <p className="text-muted">Referral rewards are currently switched off. Attribution is still recorded.</p>
          )}
          {refLink ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-ink px-3 py-2 font-mono text-[12px]">{refLink}</code>
              <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(refLink); setCopied(true); }}>{copied ? "Copied" : "Copy"}</Button>
            </div>
          ) : (
            <p className="text-faint">Sign in to get your referral link.</p>
          )}
        </div>
      </Panel>
    </div>
  );
}
