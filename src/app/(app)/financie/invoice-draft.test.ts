import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), permission: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/finance/invoice-service", () => ({ invoiceService: { createDraft: mocks.create } }));
vi.mock("@/lib/finance/permissions", () => ({ requireFinancePermission: mocks.permission }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { createManualInvoice } from "./_actions";

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
