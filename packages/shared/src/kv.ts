import { Redis } from "ioredis";
import { logger } from "./logger";

/**
 * Key-value abstraction used for caching, rate limiting, short locks and pub/sub.
 * Redis in every real deployment; an in-memory implementation exists for local development and
 * tests only (it is not shared across processes, so the indexer→web live feed needs Redis).
 */
export interface KeyValueStore {
  readonly kind: "redis" | "memory";
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Fixed-window counter. Returns the count including this hit. */
  incrWindow(key: string, windowSeconds: number): Promise<number>;
  /** Set-if-absent with TTL; returns true when the lock was acquired. */
  setNx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>>;
  ping(): Promise<boolean>;
}

class MemoryStore implements KeyValueStore {
  readonly kind = "memory" as const;
  private data = new Map<string, { value: string; expiresAt: number | null }>();
  private listeners = new Map<string, Set<(m: string) => void>>();

  private live(key: string) {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }
  async get(key: string) {
    return this.live(key)?.value ?? null;
  }
  async set(key: string, value: string, ttlSeconds?: number) {
    this.data.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  }
  async del(key: string) {
    this.data.delete(key);
  }
  async incrWindow(key: string, windowSeconds: number) {
    const entry = this.live(key);
    const next = (entry ? Number(entry.value) : 0) + 1;
    this.data.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? Date.now() + windowSeconds * 1000 });
    return next;
  }
  async setNx(key: string, value: string, ttlSeconds: number) {
    if (this.live(key)) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }
  async publish(channel: string, message: string) {
    for (const fn of this.listeners.get(channel) ?? []) fn(message);
  }
  async subscribe(channel: string, handler: (m: string) => void) {
    const set = this.listeners.get(channel) ?? new Set();
    set.add(handler);
    this.listeners.set(channel, set);
    return async () => {
      set.delete(handler);
    };
  }
  async ping() {
    return true;
  }
}

class RedisStore implements KeyValueStore {
  readonly kind = "redis" as const;
  private readonly client: Redis;
  private subscriber: Redis | undefined;
  private handlers = new Map<string, Set<(m: string) => void>>();

  constructor(private readonly url: string) {
    this.client = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: false });
    this.client.on("error", (err) => logger.warn({ err: err.message }, "redis error"));
  }
  async get(key: string) {
    return this.client.get(key);
  }
  async set(key: string, value: string, ttlSeconds?: number) {
    if (ttlSeconds) await this.client.set(key, value, "EX", ttlSeconds);
    else await this.client.set(key, value);
  }
  async del(key: string) {
    await this.client.del(key);
  }
  async incrWindow(key: string, windowSeconds: number) {
    const results = await this.client.multi().incr(key).expire(key, windowSeconds, "NX").exec();
    const count = results?.[0]?.[1];
    return typeof count === "number" ? count : Number(count ?? 0);
  }
  async setNx(key: string, value: string, ttlSeconds: number) {
    return (await this.client.set(key, value, "EX", ttlSeconds, "NX")) === "OK";
  }
  async publish(channel: string, message: string) {
    await this.client.publish(channel, message);
  }
  async subscribe(channel: string, handler: (m: string) => void) {
    if (!this.subscriber) {
      this.subscriber = new Redis(this.url, { maxRetriesPerRequest: null });
      this.subscriber.on("message", (ch: string, msg: string) => {
        for (const fn of this.handlers.get(ch) ?? []) fn(msg);
      });
    }
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.subscriber.subscribe(channel);
    }
    set.add(handler);
    return async () => {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(channel);
        await this.subscriber?.unsubscribe(channel);
      }
    };
  }
  async ping() {
    try {
      return (await this.client.ping()) === "PONG";
    } catch {
      return false;
    }
  }
}

const globalForKv = globalThis as unknown as { __kv?: KeyValueStore };

export function getKv(redisUrl: string | undefined = process.env.REDIS_URL): KeyValueStore {
  if (!globalForKv.__kv) {
    if (redisUrl) {
      globalForKv.__kv = new RedisStore(redisUrl);
    } else {
      if (process.env.NODE_ENV === "production") {
        logger.warn("REDIS_URL not set: using in-memory store (single process only, not for production)");
      }
      globalForKv.__kv = new MemoryStore();
    }
  }
  return globalForKv.__kv;
}

export function createMemoryStore(): KeyValueStore {
  return new MemoryStore();
}

export const CHANNELS = {
  market: (mint: string) => `market:${mint}`,
  otc: (mint: string) => `otc:${mint}`,
  wallet: (address: string) => `wallet:${address}`,
  global: "global",
} as const;
