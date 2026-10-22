import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), revalidate: vi.fn(),
  sale: vi.fn(), invoice: vi.fn(), rows: vi.fn(), count: vi.fn(), updateMany: vi.fn(), audit: vi.fn(), raw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/finance/permissions", () => ({ requireFinancePermission: vi.fn().mockResolvedValue({ userId: "u1", email: "admin@example.test" }) }));

import { matchEkasaReceipt } from "./_actions";

const tx = {
  ekasaSale: { findUnique: mocks.sale, findMany: mocks.rows, count: mocks.count, updateMany: mocks.updateMany },
  invoice: { findUnique: mocks.invoice },
  auditLog: { create: mocks.audit },
  $queryRaw: mocks.raw,
};

describe("párovanie eKasa dokladu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback(tx));
    mocks.sale.mockResolvedValue({ id: "s1", source: "VRP2_XLSX", receiptNumber: "R1", saleDate: new Date("2026-10-22T08:00:00Z") });
    mocks.invoice.mockResolvedValue({ id: "i1", direction: "VYDANA", documentType: "INVOICE", documentStatus: "ISSUED", totalGrossCents: 1000 });
    mocks.rows.mockResolvedValue([
      { id: "s1", totalGrossCents: 600, matchedInvoiceId: null },
      { id: "s2", totalGrossCents: 400, matchedInvoiceId: null },
    ]);
    mocks.count.mockResolvedValue(0);
  });

  it("spáruje všetky položky dokladu až po zhode celej sumy", async () => {
    const form = new FormData(); form.set("invoiceNumber", "FA2026001");
    expect(await matchEkasaReceipt("s1", {}, form)).toEqual({ success: "eKasa doklad a faktúra sú spárované." });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["s1", "s2"] } }, data: { matchedInvoiceId: "i1" },
    });
  });

  it("pri rozdielnej sume nespáruje nič", async () => {
    mocks.invoice.mockResolvedValue({ id: "i1", direction: "VYDANA", documentType: "INVOICE", documentStatus: "ISSUED", totalGrossCents: 999 });
    const form = new FormData(); form.set("invoiceNumber", "FA2026001");
    const result = await matchEkasaReceipt("s1", {}, form);
    expect(result.error).toContain("nezhoduje");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
