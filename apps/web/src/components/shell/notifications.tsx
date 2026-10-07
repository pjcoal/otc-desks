"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";
import { Popover } from "radix-ui";
import { relativeTime } from "@app/shared";
import { api, post } from "@/lib/api";
import { useAuth } from "@/components/providers/auth";
import { cn } from "@/lib/cn";

interface Note {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function Notifications() {
  const { wallet } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ items: Note[]; unread: number }>("/api/notifications"), enabled: !!wallet, refetchInterval: 60_000 });
  const read = useMutation({ mutationFn: () => post("/api/notifications/read", {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }) });
  if (!wallet) return null;
  return (
    <Popover.Root onOpenChange={(o) => !o && data?.unread && read.mutate()}>
      <Popover.Trigger className="relative flex size-8 items-center justify-center rounded-[var(--radius-control)] text-muted hover:bg-hover hover:text-text" aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ""}`}>
        <Bell className="size-4" />
        {!!data?.unread && <span className="num absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-glacier px-1 text-center text-[10px] font-semibold leading-4 text-ink">{data.unread > 9 ? "9+" : data.unread}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="panel z-50 w-[min(360px,calc(100vw-24px))] p-1 shadow-xl">
          <p className="px-3 py-2 text-[13px] font-semibold">Activity</p>
          <div className="max-h-96 overflow-y-auto">
            {!data?.items.length && <p className="px-3 pb-3 text-muted">Offers, counters and settlement steps that need you show up here.</p>}
            {data?.items.map((n) => {
              const inner = (
                <div className={cn("rounded px-3 py-2 hover:bg-hover", !n.readAt && "bg-raised/60")}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium">{n.title}</p>
                    <span className="shrink-0 text-[11px] text-faint">{relativeTime(n.createdAt)}</span>
                  </div>
                  <p className="text-[13px] text-muted">{n.body}</p>
                </div>
              );
              return n.link ? (
                <Link key={n.id} href={n.link}>
                  {inner}
                </Link>
              ) : (
                <div key={n.id}>{inner}</div>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
