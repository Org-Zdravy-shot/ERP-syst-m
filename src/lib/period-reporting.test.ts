import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  invoice: { findMany: vi.fn() },
  ekasaSale: { findMany: vi.fn() },
  payment: { findMany: vi.fn() },
  productionBatch: { findMany: vi.fn() },
}));
vi.mock("./prisma", () => ({ prisma: db }));

import { getPeriodActuals, parsePlanDate, planProgress } from "./period-reporting";

describe("period planning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.invoice.findMany.mockResolvedValue([]);
    db.ekasaSale.findMany.mockResolvedValue([]);
    db.payment.findMany.mockResolvedValue([]);
    db.productionBatch.findMany.mockResolvedValue([]);
  });

  it("validates calendar dates and calculates inclusive elapsed time", () => {
    expect(parsePlanDate("2026-02-29")).toBeNull();
    const start = parsePlanDate("2026-10-19")!;
    const end = parsePlanDate("2026-12-31")!;
    expect(planProgress(start, end, parsePlanDate("2026-10-18")!)).toBe(0);
    expect(planProgress(start, end, start)).toBeCloseTo(1 / 74);
    expect(planProgress(start, end, end)).toBe(1);
  });

  it("uses an exclusive next-day bound and keeps document, cash and production metrics separate", async () => {
    const start = parsePlanDate("2026-10-19")!;
    const end = parsePlanDate("2026-12-31")!;
    db.invoice.findMany.mockResolvedValue([
      { direction: "VYDANA", documentType: "INVOICE", issueDate: start, totalGrossCents: 12300, totalNetCents: 10000 },
      { direction: "VYDANA", documentType: "CREDIT_NOTE", issueDate: start, totalGrossCents: 1230, totalNetCents: 1000 },
      { direction: "PRIJATA", documentType: "INVOICE", issueDate: end, totalGrossCents: 6150, totalNetCents: 5000 },
      { direction: "PRIJATA", documentType: "CREDIT_NOTE", issueDate: end, totalGrossCents: 1230, totalNetCents: 1000 },
    ]);
    db.ekasaSale.findMany.mockResolvedValue([{ saleDate: end, totalGrossCents: 500 }]);
    db.payment.findMany.mockResolvedValue([
      { direction: "INCOMING", paidAt: start, amountCents: 4000 },
      { direction: "OUTGOING", paidAt: end, amountCents: 2000 },
    ]);
    db.productionBatch.findMany.mockResolvedValue([{ productionDate: end, producedQty: 80 }]);

    const result = await getPeriodActuals(start, end);
    expect(db.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ issueDate: { gte: start, lt: parsePlanDate("2027-01-01") } }),
    }));
    expect(result.total).toEqual({
      invoicedGrossCents: 11070, invoicedNetCents: 9000, ekasaGrossCents: 500,
      costsNetCents: 4000, cashInCents: 4000, cashOutCents: 2000, productionUnits: 80,
    });
    expect(result.byMonth.get("2026-12")?.costsNetCents).toBe(4000);
  });
});
