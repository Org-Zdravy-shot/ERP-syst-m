import { describe, expect, it } from "vitest";
import { canTransitionChristmasOrder, isCommercialChristmasOrder, isSettlementEligible } from "./status";

describe("Stavy vianočnej objednávky a vyúčtovanie", () => {
  it("neumožní preskočiť fakturáciu či skutočnú úhradu", () => {
    expect(canTransitionChristmasOrder("DRAFT", "PAID")).toBe(false);
    expect(canTransitionChristmasOrder("INVOICED", "PAID")).toBe(true);
    expect(canTransitionChristmasOrder("PAID", "DRAFT")).toBe(false);
    expect(canTransitionChristmasOrder("PAID", "REFUNDED")).toBe(true);
  });
  it("zahrnie len uhradenú, nevrátenú agentúrnu zákazku", () => {
    const paid = { status: "PAID", origin: "AGENCY", paidAt: new Date(), refundedAt: null, cancelledAt: null };
    expect(isSettlementEligible(paid)).toBe(true);
    expect(isSettlementEligible({ ...paid, origin: "OWN" })).toBe(false);
    expect(isSettlementEligible({ ...paid, origin: "UNKNOWN" })).toBe(false);
    expect(isSettlementEligible({ ...paid, paidAt: null })).toBe(false);
    expect(isSettlementEligible({ ...paid, status: "REFUNDED", refundedAt: new Date() })).toBe(false);
    expect(isSettlementEligible({ ...paid, status: "CANCELLED", cancelledAt: new Date() })).toBe(false);
  });
  it("dashboard nevydáva koncepty ani refundácie za realizovaný predaj", () => {
    expect(isCommercialChristmasOrder({ status: "DRAFT" })).toBe(false);
    expect(isCommercialChristmasOrder({ status: "CONFIRMED" })).toBe(true);
    expect(isCommercialChristmasOrder({ status: "PAID", paidAt: null })).toBe(false);
    expect(isCommercialChristmasOrder({ status: "PAID", paidAt: new Date() })).toBe(true);
    expect(isCommercialChristmasOrder({ status: "REFUNDED", paidAt: new Date(), refundedAt: new Date() })).toBe(false);
  });
});
