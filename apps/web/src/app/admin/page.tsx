"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { relativeTime } from "@app/shared";
import { api, post } from "@/lib/api";
import { useAuth } from "@/components/providers/auth";
import { Sol } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Panel, PanelHeader, Row } from "@/components/ui/panel";
import { Empty, ErrorNote, Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";

interface Overview {
  users: number;
  activeSessions: number;
  launches: number;
  ordersByStatus: Record<string, number>;
  settlementsByStatus: Record<string, number>;
  otcVolumeLamports: string;
  otcTradeCount: number;
  platformFeesLamports: string;
  failedSettlements: Array<{ id: string; orderId: string; status: string; reason: string | null; updatedAt: string }>;
  recentErrors: Array<{ id: string; source: string; code: string | null; message: string; createdAt: string }>;
  recentAudit: Array<{ id: string; actor: string; action: string; entityType: string; entityId: string; toStatus: string | null; createdAt: string }>;
  rpc: { slot: number | null; endpoints: Array<{ url: string; healthy: boolean; consecutiveFailures: number; requests: number; failures: number; lastError?: string; lastLatencyMs?: number }> };
  kv: { kind: string; ok: boolean };
  indexer: Array<{ stream: string; lastSlot: string; updatedAt: string; lagSlots: number | null }>;
  metrics: Record<string, number>;
}

/** Read-only operations view. Admin powers are limited to audited moderation; no signing, no funds, no edits to signed terms. */
export default function AdminPage() {
  const { session } = useAuth();
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ["admin"], enabled: !!session?.isAdmin, queryFn: () => api<Overview>("/api/admin/overview"), refetchInterval: 30_000 });
  const [orderId, setOrderId] = useState("");
  const [reason, setReason] = useState("");
  const invalidate = useMutation({
    mutationFn: () => post(`/api/admin/orders/${orderId.trim()}/invalidate`, { reason }),
    onSuccess: () => {
      toast.success("Order invalidated", "The action was recorded in the audit log.");
      setOrderId("");
      setReason("");
      void refetch();
    },
  });
  if (!session?.isAdmin) return <Empty title="Operations is restricted">Sign in with a wallet listed in ADMIN_WALLETS.</Empty>;
  if (error) return <ErrorNote error={error} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-5">
      <h1 className="title-display text-[30px] leading-none">Operations</h1>
      <div className="grid gap-4 md:grid-cols-4">
        {[["Users", data.users], ["Active sessions", data.activeSessions], ["Launches", data.launches], ["OTC trades", data.otcTradeCount]].map(([k, v]) => (
          <Panel key={k} className="p-4"><p className="text-[13px] text-muted">{k}</p><p className="num text-[24px]">{v}</p></Panel>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Economics" />
          <dl className="p-4 text-[13px]">
            <Row label="OTC volume"><Sol lamports={data.otcVolumeLamports} /></Row>
            <Row label="Platform fees collected"><Sol lamports={data.platformFeesLamports} /></Row>
          </dl>
        </Panel>
        <Panel>
          <PanelHeader title="Orders" />
          <dl className="p-4 text-[13px]">{Object.entries(data.ordersByStatus).map(([k, v]) => <Row key={k} label={k}>{v}</Row>)}</dl>
        </Panel>
        <Panel>
          <PanelHeader title="Settlements" />
          <dl className="p-4 text-[13px]">{Object.entries(data.settlementsByStatus).map(([k, v]) => <Row key={k} label={k}>{v}</Row>)}</dl>
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="RPC and infrastructure" />
          <dl className="p-4 text-[13px]">
            <Row label="Current slot">{data.rpc.slot ?? "unreachable"}</Row>
            <Row label="Key-value store">{data.kv.kind} {data.kv.ok ? "OK" : "DOWN"}</Row>
            {data.rpc.endpoints.map((e) => (
              <Row key={e.url} label={e.url} hint={e.lastError}>
                <span className={e.healthy ? "text-buy" : "text-sell"}>{e.healthy ? "healthy" : "failing"}</span> {e.failures}/{e.requests} failed{e.lastLatencyMs ? `, ${e.lastLatencyMs} ms` : ""}
              </Row>
            ))}
            {data.indexer.map((i) => (
              <Row key={i.stream} label={`Indexer ${i.stream}`} hint={`updated ${relativeTime(i.updatedAt)}`}>
                slot {i.lastSlot}{i.lagSlots !== null ? `, ${i.lagSlots} behind` : ""}
              </Row>
            ))}
            {data.indexer.length === 0 && <Row label="Indexer">not running</Row>}
          </dl>
        </Panel>
        <Panel>
          <PanelHeader title="Invalidate an order" />
          <div className="space-y-3 p-4">
            <p className="text-[13px] text-muted">Stops this app from settling an order (for example, a scam mint). It cannot move funds, change signed terms, or revoke a transaction users already signed. Every use is audited.</p>
            <Field label="Order ID"><Input value={orderId} onChange={(e) => setOrderId(e.target.value)} /></Field>
            <Field label="Reason (recorded)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <ErrorNote error={invalidate.error} />
            <Button variant="danger" disabled={!orderId.trim() || reason.trim().length < 5} loading={invalidate.isPending} onClick={() => invalidate.mutate()}>Invalidate order</Button>
          </div>
        </Panel>
      </div>
      <Panel>
        <PanelHeader title="Failed or expired settlements (24h)" />
        {!data.failedSettlements.length ? <Empty title="None" /> : (
          <dl className="p-4 text-[13px]">{data.failedSettlements.map((f) => <Row key={f.id} label={`${f.id} (${f.status})`} hint={f.reason ?? undefined}>{relativeTime(f.updatedAt)}</Row>)}</dl>
        )}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Recent errors" />
          {!data.recentErrors.length ? <Empty title="No errors recorded" /> : <dl className="p-4 text-[13px]">{data.recentErrors.map((e) => <Row key={e.id} label={`${e.source} ${e.code ?? ""}`} hint={e.message}>{relativeTime(e.createdAt)}</Row>)}</dl>}
        </Panel>
        <Panel>
          <PanelHeader title="Audit log" />
          <dl className="max-h-[480px] overflow-y-auto p-4 text-[13px]">{data.recentAudit.map((a) => <Row key={a.id} label={a.action} hint={`${a.actor.slice(0, 18)} ${a.entityType} ${a.entityId.slice(0, 14)}${a.toStatus ? ` → ${a.toStatus}` : ""}`}>{relativeTime(a.createdAt)}</Row>)}</dl>
        </Panel>
      </div>
    </div>
  );
}
