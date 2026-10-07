"use client";
import { create } from "zustand";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "info" | "success" | "error";
interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: Tone;
}
interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

let seq = 0;
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.tone === "error" ? 9000 : 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (title: string, body?: string) => useToasts.getState().push({ title, ...(body ? { body } : {}), tone: "success" }),
  error: (title: string, body?: string) => useToasts.getState().push({ title, ...(body ? { body } : {}), tone: "error" }),
  info: (title: string, body?: string) => useToasts.getState().push({ title, ...(body ? { body } : {}), tone: "info" }),
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-12 right-3 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className="panel pointer-events-auto shadow-[4px_4px_0_rgba(0,0,0,0.35)]">
          <div className={cn("titlebar flex h-6 items-center gap-2 px-1.5 text-[13px]", t.tone === "error" && "bg-sell", t.tone === "success" && "bg-buy")}>
            <span className="flex-1">{t.tone === "error" ? "Error" : t.tone === "success" ? "Done" : "Message"}</span>
            <button onClick={() => dismiss(t.id)} className="flex size-4 items-center justify-center bg-panel text-text bevel-out active:bevel-in" aria-label="Dismiss">
              <X className="size-3" />
            </button>
          </div>
          <div className="px-3 py-2">
            <p className="font-semibold">{t.title}</p>
            {t.body && <p className="mt-0.5 break-words text-[13px] text-muted">{t.body}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
