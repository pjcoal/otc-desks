import { route } from "@/server/http";
import { registry } from "@/server/context";

/** GET /api/prices/sol-usd — Pyth SOL/USD (mainnet only; null elsewhere). Display only, never used to price trades. */
export const GET = route({}, async () => ({ solUsd: await registry().solUsd() }));
