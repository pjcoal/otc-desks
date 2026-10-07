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
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className={cn("panel pointer-events-auto flex items-start gap-3 border-l-2 px-4 py-3 shadow-xl", t.tone === "success" ? "border-l-buy" : t.tone === "error" ? "border-l-sell" : "border-l-glacier")}>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t.title}</p>
            {t.body && <p className="mt-0.5 break-words text-[13px] text-muted">{t.body}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="text-faint hover:text-text" aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
