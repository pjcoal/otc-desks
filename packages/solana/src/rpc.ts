import { Connection, type Commitment } from "@solana/web3.js";
import { metrics, logger } from "@app/shared/server";

/**
 * RPC abstraction.
 *
 * A web3.js `Connection` is created with a custom `fetch` that implements:
 *   • primary → fallback failover with a short circuit breaker on the failing endpoint,
 *   • in-flight request de-duplication for identical read calls (same method + params),
 *   • a sub-second micro-cache for account reads so one page render does not fetch the same
 *     account repeatedly.
 * Because the behaviour lives at the transport level, everything that takes a `Connection`
 * (including the Pump SDKs) inherits it, and no provider-specific API is required.
 */
export interface RpcEndpointHealth {
  url: string;
  healthy: boolean;
  consecutiveFailures: number;
  lastError?: string;
  lastErrorAt?: number;
  lastLatencyMs?: number;
  requests: number;
  failures: number;
}

export interface RpcProvider {
  /** Read-optimised: de-duplicated and micro-cached. Use for page rendering and quotes. */
  readonly connection: Connection;
  /** Failover only, never cached. Use for pre-settlement balance checks and submissions. */
  readonly freshConnection: Connection;
  health(): RpcEndpointHealth[];
}

export interface RpcProviderOptions {
  primaryUrl: string;
  fallbackUrl?: string;
  wsUrl?: string;
  commitment?: Commitment;
  timeoutMs?: number;
  /** Methods safe to de-duplicate / micro-cache. Writes are never cached. */
  cacheTtlMs?: number;
}

const DEDUPE_METHODS = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getProgramAccounts",
  "getSlot",
  "getBlockHeight",
  "getEpochInfo",
  "getMinimumBalanceForRentExemption",
  "getGenesisHash",
  "getTransaction",
  "getSignatureStatuses",
  "getSignaturesForAddress",
]);
const MICRO_CACHE_METHODS = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getMinimumBalanceForRentExemption",
  "getGenesisHash",
]);

const CIRCUIT_OPEN_MS = 30_000;

class Endpoint {
  state: RpcEndpointHealth;
  openUntil = 0;
  constructor(url: string) {
    this.state = { url: redactUrl(url), healthy: true, consecutiveFailures: 0, requests: 0, failures: 0 };
    this.url = url;
  }
  readonly url: string;
  available(now: number) {
    return now >= this.openUntil;
  }
  success(latency: number) {
    this.state.consecutiveFailures = 0;
    this.state.healthy = true;
    this.state.lastLatencyMs = latency;
  }
  failure(err: string) {
    this.state.failures++;
    this.state.consecutiveFailures++;
    this.state.lastError = err;
    this.state.lastErrorAt = Date.now();
    if (this.state.consecutiveFailures >= 3) {
      this.state.healthy = false;
      this.openUntil = Date.now() + CIRCUIT_OPEN_MS;
    }
  }
}

/** Never log API keys embedded in provider URLs. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = u.search ? "?…" : "";
    u.pathname = u.pathname.length > 12 ? `${u.pathname.slice(0, 6)}…` : u.pathname;
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return "invalid-url";
  }
}

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

interface JsonRpcRequest {
  jsonrpc: string;
  id: unknown;
  method: string;
  params?: unknown;
}

export function createRpcProvider(opts: RpcProviderOptions): RpcProvider {
  const endpoints = [new Endpoint(opts.primaryUrl), ...(opts.fallbackUrl ? [new Endpoint(opts.fallbackUrl)] : [])];
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const cacheTtlMs = opts.cacheTtlMs ?? 750;
  const inflight = new Map<string, Promise<{ status: number; body: string }>>();
  const cache = new Map<string, { at: number; body: string }>();

  async function send(body: string, init: RequestInit): Promise<{ status: number; body: string }> {
    const now = Date.now();
    const ordered = [...endpoints.filter((e) => e.available(now)), ...endpoints.filter((e) => !e.available(now))];
    let lastErr: unknown;
    for (const ep of ordered) {
      const started = Date.now();
      ep.state.requests++;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(ep.url, { ...init, body, signal: controller.signal });
        clearTimeout(timer);
        const text = await res.text();
        if (isRetryableStatus(res.status)) {
          ep.failure(`HTTP ${res.status}`);
          metrics.inc("rpc.failure");
          lastErr = new Error(`RPC HTTP ${res.status}`);
          continue;
        }
        ep.success(Date.now() - started);
        return { status: res.status, body: text };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ep.failure(message);
        metrics.inc("rpc.failure");
        logger.warn({ endpoint: ep.state.url, err: message }, "rpc request failed; trying next endpoint");
        lastErr = err;
      }
    }
    metrics.inc("rpc.exhausted");
    throw lastErr instanceof Error ? lastErr : new Error("All RPC endpoints failed");
  }

  const makeFetch = (useCache: boolean) => async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    void input; // the endpoint is chosen by the provider, not the caller
    const rawBody = typeof init?.body === "string" ? init.body : "";
    let parsed: JsonRpcRequest | undefined;
    try {
      const candidate = JSON.parse(rawBody) as unknown;
      if (candidate && !Array.isArray(candidate) && typeof candidate === "object") parsed = candidate as JsonRpcRequest;
    } catch {
      parsed = undefined;
    }

    const respond = (status: number, body: string) =>
      new Response(body, { status, headers: { "content-type": "application/json" } });

    if (!useCache || !parsed || !DEDUPE_METHODS.has(parsed.method)) {
      const r = await send(rawBody, init ?? {});
      return respond(r.status, r.body);
    }

    const key = `${parsed.method}:${JSON.stringify(parsed.params ?? null)}`;
    const withId = (body: string) => {
      try {
        const obj = JSON.parse(body) as Record<string, unknown>;
        obj.id = parsed!.id;
        return JSON.stringify(obj);
      } catch {
        return body;
      }
    };

    if (MICRO_CACHE_METHODS.has(parsed.method)) {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < cacheTtlMs) {
        metrics.inc("rpc.cache_hit");
        return respond(200, withId(hit.body));
      }
    }

    let pending = inflight.get(key);
    if (pending) {
      metrics.inc("rpc.deduped");
    } else {
      pending = send(rawBody, init ?? {}).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    const r = await pending;
    if (r.status === 200 && MICRO_CACHE_METHODS.has(parsed.method)) {
      cache.set(key, { at: Date.now(), body: r.body });
      if (cache.size > 5_000) cache.clear();
    }
    return respond(r.status, withId(r.body));
  };

  const mk = (useCache: boolean) =>
    new Connection(opts.primaryUrl, {
      commitment: opts.commitment ?? "confirmed",
      fetch: makeFetch(useCache) as typeof fetch,
      ...(opts.wsUrl ? { wsEndpoint: opts.wsUrl } : {}),
      disableRetryOnRateLimit: true,
    });

  return {
    connection: mk(true),
    freshConnection: mk(false),
    health: () => endpoints.map((e) => ({ ...e.state })),
  };
}
