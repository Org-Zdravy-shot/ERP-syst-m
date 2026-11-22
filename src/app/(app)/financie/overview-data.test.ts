import { describe, expect, it } from "vitest";
import { buildOverview, type OverviewDocument } from "./overview-data";

const invoice: OverviewDocument = {
  direction: "VYDANA",
  documentType: "INVOICE",
  source: "INTERNA",
  issueDate: new Date("2026-11-01"),
  totalNetCents: 10000,
  totalGrossCents: 12300,
  paymentAllocations: [],
};

describe("ročný prehľad fakturácie", () => {
  it("odpočíta dobropisy na správnej strane a zachová čiastočné úhrady", () => {
    const result = buildOverview([
      { ...invoice, paymentAllocations: [{ amountCents: 4000 }] },
      { ...invoice, documentType: "CREDIT_NOTE", totalNetCents: 1000, totalGrossCents: 1230 },
      { ...invoice, direction: "PRIJATA", paymentAllocations: [{ amountCents: 13300 }] },
      { ...invoice, direction: "PRIJATA", documentType: "CREDIT_NOTE", totalNetCents: 500, totalGrossCents: 615 },
    ], 2026);

    expect(result.months[10]).toEqual({
      month: 10, revenueNet: 9000, revenueGross: 11070, expensesNet: 9500, expensesGross: 11685,
    });
    expect(result.unpaidRevenue).toBe(8300);
    expect(result.unpaidExpenses).toBe(0);
  });

  it("počíta historické doklady do obratu bez domysleného salda a oddeľuje roky", () => {
    const result = buildOverview([
      { ...invoice, source: "HISTORICAL", issueDate: new Date("2026-12-31") },
      { ...invoice, issueDate: new Date("2027-01-01") },
    ], 2026);
    expect(result.months[11].revenueGross).toBe(12300);
    expect(result.months[0].revenueGross).toBe(0);
    expect(result.unpaidRevenue).toBe(0);
    expect(result.documentCount).toBe(1);
  });
});
