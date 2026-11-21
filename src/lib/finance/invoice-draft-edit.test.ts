import { beforeEach, expect, test, vi } from "vitest";
import type { UpdateInvoiceDraftInput } from "./contracts";
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), audit: vi.fn(), lock: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
import { PrismaInvoiceService } from "./invoice-service";

const version = new Date("2026-11-21T10:00:00.000Z");
const stored = { id: "draft", source: "INTERNA", direction: "VYDANA", documentType: "INVOICE", documentStatus: "DRAFT", invoiceNumber: null, finalizedAt: null, orderId: null,
  updatedAt: version, items: [], _count: { paymentAllocations: 0, documents: 0, eInvoiceTransmissions: 0 } };
function input(): UpdateInvoiceDraftInput {
  return { actorId: "actor", expectedUpdatedAt: version, legalEntity: "KURGI", clientId: "client", currency: "EUR", issueDate: new Date("2027-01-01"), dueDate: new Date("2027-01-15"), buyerReference: " BUYER-42 ",
    items: [{ description: "Shot", quantity: 2, unit: "ks", unitPriceCents: 183, unitPriceExact: "1.8270", vatRate: 23, fmcg: { properties: { buyer_order_number: "BUYER-42", batch_number: "LOT-1" } } }] };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (fn) => fn({ $queryRaw: mocks.lock, invoice: { findUnique: mocks.find, update: mocks.update }, auditLog: { create: mocks.audit } }));
  mocks.lock.mockResolvedValue([{ id: "draft" }]);
  mocks.find.mockResolvedValue(stored);
  mocks.update.mockImplementation(async ({ data }) => ({ ...stored, ...data }));
});

test("editing recalculates prices and atomically replaces lines while preserving FMCG", async () => {
  const result = await new PrismaInvoiceService().updateDraft("draft", input());
  expect(result.calculation.totalGrossCents).toBe(449);
  const data = mocks.update.mock.calls[0][0].data;
  expect(data.buyerReference).toBe("BUYER-42");
  expect(data.items.deleteMany).toEqual({});
  expect(data.items.create[0]).toMatchObject({ unitPriceExact: "1.8270", totalNetCents: 365, fmcgSnapshot: { properties: { batch_number: "LOT-1" } } });
  expect(data.updatedAt.getTime()).toBeGreaterThan(version.getTime());
  expect(data).not.toHaveProperty("invoiceNumber");
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "INVOICE_DRAFT_UPDATED", entityId: "draft" }) }));
});

test.each([
  { documentStatus: "ISSUED" }, { documentStatus: "CANCELLED" }, { invoiceNumber: "2027001" }, { finalizedAt: new Date() },
  { source: "HISTORICAL" }, { source: "SUPERFAKTURA" }, { direction: "PRIJATA" }, { documentType: "CREDIT_NOTE" }, { orderId: "order" },
  { consolidatedFrom: new Date("2027-01-01") },
  { _count: { paymentAllocations: 1, documents: 0, eInvoiceTransmissions: 0 } },
  { _count: { paymentAllocations: 0, documents: 1, eInvoiceTransmissions: 0 } },
  { _count: { paymentAllocations: 0, documents: 0, eInvoiceTransmissions: 1 } },
])("editing rejects protected documents %j before writing", async patch => {
  mocks.find.mockResolvedValue({ ...stored, ...patch });
  await expect(new PrismaInvoiceService().updateDraft("draft", input())).rejects.toThrow();
  expect(mocks.update).not.toHaveBeenCalled();
});

test("stale editor cannot overwrite a more recent version", async () => {
  mocks.find.mockResolvedValue({ ...stored, updatedAt: new Date(version.getTime() + 1) });
  await expect(new PrismaInvoiceService().updateDraft("draft", input())).rejects.toThrow("medzitým zmenil");
  expect(mocks.update).not.toHaveBeenCalled();
});

test("invalid line metadata cannot erase the current items", async () => {
  const patch = input(); patch.items[0].fmcg!.properties.expiry_date = "2027-02-30";
  await expect(new PrismaInvoiceService().updateDraft("draft", patch)).rejects.toThrow("expiry_date");
  expect(mocks.transaction).not.toHaveBeenCalled();
});

test("invalid buyer reference is rejected before persistence", async () => {
  await expect(new PrismaInvoiceService().updateDraft("draft", { ...input(), buyerReference: "A\u0001B" })).rejects.toThrow("Referencia odberateľa");
  expect(mocks.transaction).not.toHaveBeenCalled();
});
