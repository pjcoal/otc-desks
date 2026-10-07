import type { NotificationType, Tx } from "@app/database";
import { CHANNELS, type KeyValueStore } from "@app/shared/server";

export interface NotifyInput {
  wallet: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  orderId?: string;
}

/** Persist in-app notifications inside the caller's DB transaction; publish after commit. */
export async function notify(tx: Tx, items: NotifyInput[]): Promise<NotifyInput[]> {
  if (items.length === 0) return items;
  await tx.notification.createMany({
    data: items.map((n) => ({ wallet: n.wallet, type: n.type, title: n.title, body: n.body, link: n.link ?? null, orderId: n.orderId ?? null })),
  });
  return items;
}

/** Fire-and-forget live push (SSE) after the transaction committed. Delivery adapters (email/Telegram/Discord) hook in here. */
export async function publishNotifications(kv: KeyValueStore, items: NotifyInput[]): Promise<void> {
  await Promise.all(items.map((n) => kv.publish(CHANNELS.wallet(n.wallet), JSON.stringify({ kind: "notification", type: n.type, title: n.title, link: n.link ?? null })).catch(() => {})));
}
