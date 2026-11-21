import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), permission: vi.fn(), redirect: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/finance/invoice-service", () => ({ invoiceService: { createDraft: mocks.create } }));
vi.mock("@/lib/finance/permissions", () => ({ requireFinancePermission: mocks.permission }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { createConsolidatedInvoice } from "./_actions";
function form() {
  const data = new FormData();
  data.set("issueDate", "2027-01-31"); data.set("dueDate", "2027-02-14"); data.set("buyerReference", "BUYER");
  data.set("orders", JSON.stringify(["a", "b"].map(orderId => ({ orderId, expectedUpdatedAt: "2027-01-20T10:00:00.000Z", deliveryDate: "2027-01-20", buyerOrderNumber: `BUYER-${orderId}` }))));
  return data;
}
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue({ userId: "actor" }); mocks.create.mockResolvedValue({ id: "draft" }); mocks.redirect.mockImplementation(() => { throw new Error("redirect"); }); });
test("permission is checked before processing a submitted selection", async () => {
  mocks.permission.mockRejectedValue(new Error("forbidden"));
  await expect(createConsolidatedInvoice({}, form())).rejects.toThrow("forbidden");
  expect(mocks.create).not.toHaveBeenCalled();
});
test("submitted prices and actor IDs cannot replace authoritative order prices or current user", async () => {
  const data = form(); data.set("actorId", "attacker"); data.set("items", JSON.stringify([{ unitPriceCents: 1 }]));
  await expect(createConsolidatedInvoice({}, data)).rejects.toThrow("redirect");
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ actorId: "actor", items: [], consolidation: expect.arrayContaining([expect.objectContaining({ orderId: "a" })]) }));
  expect(mocks.revalidate).toHaveBeenCalledWith("/objednavky/a");
});
test("invalid calendar date does not create a draft", async () => {
  const data = form(); data.set("issueDate", "2027-02-30");
  expect(await createConsolidatedInvoice({}, data)).toMatchObject({ error: expect.stringContaining("Dátum vystavenia") });
  expect(mocks.create).not.toHaveBeenCalled();
});
test("conflicting source errors are shown without redirecting", async () => {
  mocks.create.mockRejectedValue(new Error("K objednávke už existuje koncept faktúry."));
  expect(await createConsolidatedInvoice({}, form())).toMatchObject({ error: "K objednávke už existuje koncept faktúry." });
  expect(mocks.redirect).not.toHaveBeenCalled();
});
