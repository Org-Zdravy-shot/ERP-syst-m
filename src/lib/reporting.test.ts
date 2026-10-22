import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  invoices: vi.fn(), ekasa: vi.fn(), batches: vi.fn(),
}));
vi.mock("./prisma", () => ({ prisma: {
  invoice: { findMany: db.invoices },
  ekasaSale: { findMany: db.ekasa },
  productionBatch: { findMany: db.batches },
} }));

import { actualsFor, getMonthlyActualsMap } from "./reporting";

describe("mesačný prehľad evidovaných predajov", () => {
  beforeEach(() => vi.clearAllMocks());

  it("odpočíta dobropis a berie len eKasa položky bez párovania", async () => {
    db.invoices.mockResolvedValue([
      { issueDate: new Date("2026-10-10"), documentType: "INVOICE", totalGrossCents: 1200 },
      { issueDate: new Date("2026-10-11"), documentType: "CREDIT_NOTE", totalGrossCents: 200 },
    ]);
    db.ekasa.mockResolvedValue([{ saleDate: new Date("2026-10-12"), totalGrossCents: 300 }]);
    db.batches.mockResolvedValue([{ productionDate: new Date("2026-10-13"), producedQty: 5 }]);

    expect(actualsFor(await getMonthlyActualsMap(), 2026, 10)).toEqual({ revenueCents: 1300, productionUnits: 5 });
    expect(db.ekasa).toHaveBeenCalledWith({
      where: { matchedInvoiceId: null }, select: { saleDate: true, totalGrossCents: true },
    });
  });
});
