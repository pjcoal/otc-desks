import type { NextRequest } from "next/server";
import { CHANNELS, getKv } from "@app/shared/server";
import { isBase58PublicKey } from "@app/shared";
import { currentSession } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/stream?mint= — Server-Sent Events. Public market/OTC channels for one mint, plus the
 * signed-in wallet's private notification channel. Clients reconnect automatically (EventSource).
 */
export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint");
  const session = await currentSession().catch(() => null);
  const channels = [CHANNELS.global, ...(mint && isBase58PublicKey(mint) ? [CHANNELS.market(mint), CHANNELS.otc(mint)] : []), ...(session ? [CHANNELS.wallet(session.wallet)] : [])];
  const kv = getKv();
  const encoder = new TextEncoder();
  let cleanup: Array<() => Promise<void>> = [];
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: string) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          // closed
        }
      };
      send("ready", JSON.stringify({ channels: channels.map((c) => (c.startsWith("wallet:") ? "wallet" : c)) }));
      cleanup = await Promise.all(channels.map((ch) => kv.subscribe(ch, (msg) => send(ch.startsWith("wallet:") ? "wallet" : ch.split(":")[0]!, msg))));
      heartbeat = setInterval(() => send("ping", String(Date.now())), 20_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        void Promise.all(cleanup.map((f) => f()));
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      clearInterval(heartbeat);
      void Promise.all(cleanup.map((f) => f()));
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
