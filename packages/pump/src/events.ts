import { PUMP_SDK, pumpIdl } from "@pump-fun/pump-sdk";
import { pumpAmmJson } from "@pump-fun/pump-swap-sdk";
import bs58 from "bs58";
import type { ParsedTransactionWithMeta, VersionedTransactionResponse } from "@solana/web3.js";
import { ANCHOR_EVENT_IX_TAG, PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from "./constants";
import { fromBN, isSolQuoted } from "./bonding-curve";

type IdlEvent = { name: string; discriminator: number[] };

function discMap(events: IdlEvent[]): Map<string, string> {
  return new Map(events.map((e) => [Buffer.from(e.discriminator).toString("hex"), e.name]));
}

const PUMP_EVENTS = discMap((pumpIdl as unknown as { events: IdlEvent[] }).events);
const AMM_EVENTS = discMap((pumpAmmJson as unknown as { events: IdlEvent[] }).events);

export type PumpDecodedEvent =
  | {
      program: "PUMP";
      kind: "CREATE";
      mint: string;
      creator: string;
      user: string;
      name: string;
      symbol: string;
      uri: string;
      bondingCurve: string;
      tokenProgram: string;
      quoteMint: string;
      isMayhemMode: boolean;
      isHolderReward: boolean;
      timestamp: number;
    }
  | {
      program: "PUMP";
      kind: "TRADE";
      mint: string;
      user: string;
      isBuy: boolean;
      solAmount: bigint;
      tokenAmount: bigint;
      fee: bigint;
      creatorFee: bigint;
      virtualSolReserves: bigint;
      virtualTokenReserves: bigint;
      realSolReserves: bigint;
      realTokenReserves: bigint;
      quoteMint: string;
      timestamp: number;
    }
  | { program: "PUMP"; kind: "COMPLETE"; mint: string; user: string; bondingCurve: string; timestamp: number }
  | {
      program: "PUMP_AMM";
      kind: "CREATE_POOL";
      pool: string;
      baseMint: string;
      quoteMint: string;
      creator: string;
      coinCreator: string;
      poolBaseAmount: bigint;
      poolQuoteAmount: bigint;
      timestamp: number;
    }
  | {
      program: "PUMP_AMM";
      kind: "AMM_BUY" | "AMM_SELL";
      pool: string;
      user: string;
      baseAmount: bigint;
      quoteAmount: bigint;
      protocolFee: bigint;
      lpFee: bigint;
      coinCreatorFee: bigint;
      poolBaseReserves: bigint;
      poolQuoteReserves: bigint;
      timestamp: number;
    };

const num = (v: { toString(): string }) => Number(v.toString());

function decodePump(name: string, payload: Buffer): PumpDecodedEvent | null {
  switch (name) {
    case "CreateEvent": {
      const e = PUMP_SDK.decodeCreateEventBc(payload);
      return {
        program: "PUMP",
        kind: "CREATE",
        mint: e.mint.toBase58(),
        creator: e.creator.toBase58(),
        user: e.user.toBase58(),
        name: e.name,
        symbol: e.symbol,
        uri: e.uri,
        bondingCurve: e.bondingCurve.toBase58(),
        tokenProgram: e.tokenProgram.toBase58(),
        quoteMint: isSolQuoted(e.quoteMint) ? "SOL" : e.quoteMint.toBase58(),
        isMayhemMode: e.isMayhemMode,
        isHolderReward: e.isHolderReward,
        timestamp: num(e.timestamp),
      };
    }
    case "TradeEvent": {
      const e = PUMP_SDK.decodeTradeEventBc(payload);
      return {
        program: "PUMP",
        kind: "TRADE",
        mint: e.mint.toBase58(),
        user: e.user.toBase58(),
        isBuy: e.isBuy,
        solAmount: fromBN(e.solAmount),
        tokenAmount: fromBN(e.tokenAmount),
        fee: fromBN(e.fee),
        creatorFee: fromBN(e.creatorFee),
        virtualSolReserves: fromBN(e.virtualSolReserves),
        virtualTokenReserves: fromBN(e.virtualTokenReserves),
        realSolReserves: fromBN(e.realSolReserves),
        realTokenReserves: fromBN(e.realTokenReserves),
        quoteMint: isSolQuoted(e.quoteMint) ? "SOL" : e.quoteMint.toBase58(),
        timestamp: num(e.timestamp),
      };
    }
    case "CompleteEvent": {
      const e = PUMP_SDK.decodeCompleteEventBc(payload);
      return { program: "PUMP", kind: "COMPLETE", mint: e.mint.toBase58(), user: e.user.toBase58(), bondingCurve: e.bondingCurve.toBase58(), timestamp: num(e.timestamp) };
    }
    default:
      return null;
  }
}

function decodeAmm(name: string, payload: Buffer): PumpDecodedEvent | null {
  switch (name) {
    case "CreatePoolEvent": {
      const e = PUMP_SDK.decodeCreatePoolEventAmm(payload);
      return {
        program: "PUMP_AMM",
        kind: "CREATE_POOL",
        pool: e.pool.toBase58(),
        baseMint: e.baseMint.toBase58(),
        quoteMint: isSolQuoted(e.quoteMint) ? "SOL" : e.quoteMint.toBase58(),
        creator: e.creator.toBase58(),
        coinCreator: e.coinCreator.toBase58(),
        poolBaseAmount: fromBN(e.poolBaseAmount),
        poolQuoteAmount: fromBN(e.poolQuoteAmount),
        timestamp: num(e.timestamp),
      };
    }
    case "BuyEvent": {
      const e = PUMP_SDK.decodeBuyEventAmm(payload);
      return {
        program: "PUMP_AMM",
        kind: "AMM_BUY",
        pool: e.pool.toBase58(),
        user: e.user.toBase58(),
        baseAmount: fromBN(e.baseAmountOut),
        quoteAmount: fromBN(e.userQuoteAmountIn),
        protocolFee: fromBN(e.protocolFee),
        lpFee: fromBN(e.lpFee),
        coinCreatorFee: fromBN(e.coinCreatorFee),
        poolBaseReserves: fromBN(e.poolBaseTokenReserves),
        poolQuoteReserves: fromBN(e.poolQuoteTokenReserves),
        timestamp: num(e.timestamp),
      };
    }
    case "SellEvent": {
      const e = PUMP_SDK.decodeSellEventAmm(payload);
      return {
        program: "PUMP_AMM",
        kind: "AMM_SELL",
        pool: e.pool.toBase58(),
        user: e.user.toBase58(),
        baseAmount: fromBN(e.baseAmountIn),
        quoteAmount: fromBN(e.userQuoteAmountOut),
        protocolFee: fromBN(e.protocolFee),
        lpFee: fromBN(e.lpFee),
        coinCreatorFee: fromBN(e.coinCreatorFee),
        poolBaseReserves: fromBN(e.poolBaseTokenReserves),
        poolQuoteReserves: fromBN(e.poolQuoteTokenReserves),
        timestamp: num(e.timestamp),
      };
    }
    default:
      return null;
  }
}

/** Decode one raw event (discriminator + payload) emitted by `programId`. */
export function decodeEventBytes(programId: string, bytes: Buffer): PumpDecodedEvent | null {
  if (bytes.length < 8) return null;
  const disc = bytes.subarray(0, 8).toString("hex");
  const payload = bytes.subarray(8);
  try {
    if (programId === PUMP_PROGRAM_ID.toBase58()) {
      const name = PUMP_EVENTS.get(disc);
      return name ? decodePump(name, payload) : null;
    }
    if (programId === PUMP_AMM_PROGRAM_ID.toBase58()) {
      const name = AMM_EVENTS.get(disc);
      return name ? decodeAmm(name, payload) : null;
    }
  } catch {
    return null; // malformed / unknown layout: skip rather than poison the index
  }
  return null;
}

const INVOKE = /^Program (\w+) invoke \[\d+\]$/;
const EXIT = /^Program (\w+) (success|failed)/;
const DATA = /^Program data: (.+)$/;

/** Raw `emit!` payloads from log lines, attributed to the program on top of the invoke stack. */
function logEventPayloads(logs: readonly string[]): Array<[program: string, bytes: Buffer]> {
  const stack: string[] = [];
  const out: Array<[string, Buffer]> = [];
  for (const line of logs) {
    const inv = INVOKE.exec(line);
    if (inv?.[1]) {
      stack.push(inv[1]);
      continue;
    }
    if (EXIT.test(line)) {
      stack.pop();
      continue;
    }
    const data = DATA.exec(line);
    const program = stack[stack.length - 1];
    if (data?.[1] && program) out.push([program, Buffer.from(data[1], "base64")]);
  }
  return out;
}

/** Events visible from logs alone (used on websocket log notifications). */
export function eventsFromLogs(logs: readonly string[]): PumpDecodedEvent[] {
  return logEventPayloads(logs)
    .map(([program, bytes]) => decodeEventBytes(program, bytes))
    .filter((e): e is PumpDecodedEvent => e !== null);
}

/**
 * Decode every Pump / PumpSwap event in a fetched transaction: both `emit!` log events and
 * `emit_cpi!` self-CPI events, de-duplicated, in deterministic order. Failed transactions yield none.
 */
export function eventsFromTransaction(tx: VersionedTransactionResponse): PumpDecodedEvent[] {
  if (!tx.meta || tx.meta.err) return [];
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses ?? null });
  const seen = new Set<string>();
  const out: PumpDecodedEvent[] = [];
  const push = (programId: string, bytes: Buffer) => {
    const key = `${programId}:${bytes.toString("base64")}`;
    if (seen.has(key)) return;
    const ev = decodeEventBytes(programId, bytes);
    if (ev) {
      seen.add(key);
      out.push(ev);
    }
  };

  for (const [program, bytes] of logEventPayloads(tx.meta.logMessages ?? [])) push(program, bytes);
  // Self-CPI events: inner instruction to the program itself, data = EVENT_IX_TAG ++ event.
  const tag = Buffer.from(ANCHOR_EVENT_IX_TAG);
  for (const group of tx.meta.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      const programId = keys.get(ix.programIdIndex)?.toBase58();
      if (!programId) continue;
      if (programId !== PUMP_PROGRAM_ID.toBase58() && programId !== PUMP_AMM_PROGRAM_ID.toBase58()) continue;
      const data = Buffer.from(bs58.decode(ix.data));
      if (data.length > 16 && data.subarray(0, 8).equals(tag)) push(programId, data.subarray(8));
    }
  }
  return out;
}

export type { ParsedTransactionWithMeta };
