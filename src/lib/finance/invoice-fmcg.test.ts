import { beforeEach, expect, test, vi } from "vitest";
import type { CreateInvoiceDraftInput } from "./contracts";

const mocks = vi.hoisted(() => ({ create: vi.fn(), findUnique: vi.fn(), audit: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: mocks.transaction,
  invoice: { findUnique: mocks.findUnique },
} }));

import { PrismaInvoiceService } from "./invoice-service";
import { calculateInvoice } from "./domain";

const fmcg = { gtin: "8589000072245", properties: { buyer_order_number: "101-ORDER-42", batch_number: "SARZA-7", expiry_date: "2027-03-31", vat_amount: "2.30" } };
function draft(): CreateInvoiceDraftInput {
  return {
    direction: "VYDANA", legalEntity: "KURGI", currency: "EUR", actorId: "actor", clientId: "client",
    issueDate: new Date("2027-01-01"), dueDate: new Date("2027-01-15"), buyerReference: "BUYER-42",
    items: [{ description: "Shot", unit: "ks", quantity: 10, unitPriceCents: 100, vatRate: 23, fmcg: structuredClone(fmcg) }],
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (fn) => fn({ invoice: { create: mocks.create }, auditLog: { create: mocks.audit } }));
  mocks.create.mockImplementation(async ({ data }) => ({ id: "new", ...data }));
});

test("draft persists separate validated FMCG snapshots for each invoice line", async () => {
  const input = draft();
  input.items.push({ ...input.items[0], fmcg: { properties: { buyer_order_number: "101-ORDER-43", batch_number: "SARZA-8" } } });
  await new PrismaInvoiceService().createDraft(input);
  const saved = mocks.create.mock.calls[0][0].data.items.create;
  expect(saved[0].fmcgSnapshot).toEqual(fmcg);
  expect(mocks.create.mock.calls[0][0].data.buyerReference).toBe("BUYER-42");
  expect(saved[1].fmcgSnapshot.properties.batch_number).toBe("SARZA-8");
  input.items[0].fmcg!.properties.batch_number = "CHANGED";
  expect(saved[0].fmcgSnapshot.properties.batch_number).toBe("SARZA-7");
});

test("invalid FMCG is rejected before a draft is written", async () => {
  const input = draft();
  input.items[0].fmcg!.properties.expiry_date = "2027-02-30";
  await expect(new PrismaInvoiceService().createDraft(input)).rejects.toThrow("Riadok 1, FMCG properties.expiry_date");
  expect(mocks.transaction).not.toHaveBeenCalled();
});

test("VAT changes cannot silently retain incompatible metadata", () => {
  const input = draft();
  expect(() => calculateInvoice({ currency: "EUR", lines: [{ ...input.items[0], vatRate: 19 }] })).toThrow("FMCG vat_amount");
});

test("full credit note preserves stored FMCG references", async () => {
  const originalLine = calculateInvoice({ currency: "EUR", lines: draft().items }).lines[0];
  mocks.findUnique.mockResolvedValue({
    id: "original", direction: "VYDANA", legalEntity: "KURGI", documentType: "INVOICE", documentStatus: "ISSUED",
    clientId: "client", client: null, counterpartySnapshot: { name: "Odberateľ", country: "SK" }, buyerReference: "BUYER-42",
    creditNotes: [], totalGrossCents: 1230, items: [{ ...originalLine, fmcgSnapshot: fmcg }],
  });
  await new PrismaInvoiceService().createCreditNote({
    originalInvoiceId: "original", issueDate: new Date("2027-01-10"), dueDate: new Date("2027-01-20"), deliveryDate: new Date("2027-01-10"), reason: "Vrátenie", actorId: "actor",
  });
  expect(mocks.create.mock.calls[0][0].data.items.create[0].fmcgSnapshot).toEqual(fmcg);
  expect(mocks.create.mock.calls[0][0].data.buyerReference).toBe("BUYER-42");
});
