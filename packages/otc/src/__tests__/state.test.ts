import { describe, expect, it } from "vitest";
import { canTransition, fromStatusesFor, TERMINAL_STATUSES } from "../state";

describe("order state machine", () => {
  it("happy path", () => {
    expect(canTransition("OPEN", "ACCEPTED")).toBe(true);
    expect(canTransition("ACCEPTED", "SETTLEMENT_READY")).toBe(true);
    expect(canTransition("SETTLEMENT_READY", "FILLED")).toBe(true);
  });
  it("filled and failed orders never move", () => {
    for (const to of ["OPEN", "ACCEPTED", "SETTLEMENT_READY", "CANCELLED", "FILLED"] as const) {
      expect(canTransition("FILLED", to)).toBe(false);
      expect(canTransition("FAILED", to)).toBe(false);
    }
  });
  it("cancelled/expired orders can only become filled with on-chain proof", () => {
    expect(canTransition("CANCELLED", "FILLED")).toBe(false);
    expect(canTransition("CANCELLED", "FILLED", { chainProof: true })).toBe(true);
    expect(canTransition("EXPIRED", "SETTLEMENT_READY")).toBe(false);
    expect(canTransition("CANCELLED", "OPEN")).toBe(false);
  });
  it("cannot jump from OPEN straight to FILLED", () => {
    expect(canTransition("OPEN", "FILLED")).toBe(false);
  });
  it("fromStatusesFor never includes terminal sources without proof", () => {
    for (const s of fromStatusesFor("FILLED")) expect(TERMINAL_STATUSES.has(s)).toBe(false);
  });
});
