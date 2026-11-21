import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), permission: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/finance/invoice-service", () => ({ invoiceService: { createDraft: mocks.create, updateDraft: mocks.update } }));
vi.mock("@/lib/finance/permissions", () => ({ requireFinancePermission: mocks.permission }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { createManualInvoice, updateManualInvoice } from "./_actions";

const item = { description: "Shot", quantity: 2, unit: "ks", unitPriceCents: 100, unitPriceExact: "1.0000", vatRate: 23 };
function form(items: unknown[]) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ direction: "VYDANA", legalEntity: "KURGI", clientId: "client", issueDate: "2027-01-01", dueDate: "2027-01-15", deliveryDate: "2027-01-01", items: JSON.stringify(items) })) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ userId: "actor" });
  mocks.create.mockResolvedValue({ id: "draft" });
  mocks.update.mockResolvedValue({ id: "draft" });
  mocks.redirect.mockImplementation(() => { throw new Error("redirect"); });
});

test("manual invoice passes row-level references to persistent draft creation", async () => {
  const fmcg = { gtin: "8589000072245", properties: { buyer_order_number: "101-42", batch_number: "LOT-1" } };
  await expect(createManualInvoice({}, form([{ ...item, fmcg }]))).rejects.toThrow("redirect");
  expect(mocks.create.mock.calls[0][0].items[0].fmcg).toEqual(fmcg);
  expect(mocks.redirect).toHaveBeenCalledWith("/financie/faktury/draft");
});

test("invalid metadata reports the exact second row and does not save anything", async () => {
  const result = await createManualInvoice({}, form([item, { ...item, fmcg: { properties: { expiry_date: "2027-02-30" } } }]));
  expect(result.error).toContain("Riadok 2, fmcg.properties.expiry_date");
  expect(mocks.create).not.toHaveBeenCalled();
});

test("a blank second row cannot silently disappear from a submitted invoice", async () => {
  const result = await createManualInvoice({}, form([item, { ...item, description: "" }]));
  expect(result.error).toContain("Riadok 2, description");
  expect(mocks.create).not.toHaveBeenCalled();
});

test("edit passes the version, product link, exact price and buyer reference without creating another invoice", async () => {
  const data = form([{ ...item, productId: "product", taxCategory: "STANDARD" }]);
  data.set("expectedUpdatedAt", "2026-11-21T10:00:00.000Z");
  data.set("buyerReference", "BUYER-42");
  await expect(updateManualInvoice("draft", {}, data)).rejects.toThrow("redirect");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith("draft", expect.objectContaining({ buyerReference: "BUYER-42", expectedUpdatedAt: new Date("2026-11-21T10:00:00.000Z"), items: [expect.objectContaining({ productId: "product", unitPriceExact: "1.0000", taxCategory: "STANDARD" })] }));
});

test("edit checks finance permission before invoking the service", async () => {
  mocks.permission.mockRejectedValue(new Error("forbidden"));
  await expect(updateManualInvoice("draft", {}, form([item]))).rejects.toThrow("forbidden");
  expect(mocks.update).not.toHaveBeenCalled();
});

test("missing edit version is rejected without writes", async () => {
  expect(await updateManualInvoice("draft", {}, form([item]))).toMatchObject({ error: expect.stringContaining("verzia konceptu") });
  expect(mocks.update).not.toHaveBeenCalled();
});

test("dates cannot silently normalize February 30 into March", async () => {
  const data = form([item]); data.set("issueDate", "2027-02-30");
  expect(await createManualInvoice({}, data)).toEqual({ error: "Dátum vystavenia: zadajte platný dátum." });
  expect(mocks.create).not.toHaveBeenCalled();
});
