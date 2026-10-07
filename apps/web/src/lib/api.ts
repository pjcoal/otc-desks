"use client";
import type { ApiErrorBody, ErrorCode } from "@app/shared";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | "NETWORK",
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Same-origin JSON fetch. The X-Requested-With header is part of our CSRF defence. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      credentials: "same-origin",
      headers: { "x-requested-with": "fetch", ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(headers ?? {}) },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch {
    throw new ApiError("NETWORK", "Can't reach the server. Check your connection and retry.", 0);
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(err?.code ?? "INTERNAL", err?.message ?? `Request failed (${res.status}).`, res.status, err?.details);
  }
  return data as T;
}

export const post = <T>(path: string, json: unknown) => api<T>(path, { method: "POST", json });
