import { expect, test, vi } from "vitest";
import { buildConsolidation, lockUnbilledOrders, sourceOrderHash } from "./consolidation";
import { calculateInvoice } from "./domain";
type Source = Parameters<typeof buildConsolidation>[0][number];
const version = "2027-01-21T10:00:00.000Z";
function order(id: string): Source {
  return { id, orderNumber: `OBJ-${id}`, clientId: "client", legalEntity: "KURGI", orderDate: new Date("2027-01-01"), updatedAt: new Date(version), status: "DORUCENA", shipmentStatus: null,
    items: [{ id: `${id}-item`, productId: "product", product: { name: "Shot", sku: "SHOT", unit: "ks" }, quantity: 3, unitPriceCents: 183, unitPriceExact: { toString: () => "1.8270" }, vatRate: 23 }],
    charges: [{ id: `${id}-shipping`, description: "Doprava", unitPriceCents: 100, vatRate: 23, taxTreatment: "STANDARD", includedInSellerTotal: true },
      { id: `${id}-platform`, description: "Poplatok platformy", unitPriceCents: 900, vatRate: 23, includedInSellerTotal: false }],
  } as unknown as Source;
}
function selection(id: string, day = "10") { return { orderId: id, expectedUpdatedAt: version, deliveryDate: `2027-01-${day}`, buyerOrderNumber: `BUYER-${id}`, deliveryNoteNumber: `DL-${id}` }; }
const issueDate = new Date("2027-01-31");
test("summary retains complete-order exact prices, seller charges and separate matching references", () => {
  const result = buildConsolidation([order("a"), order("b")], [selection("a"), selection("b", "20")], issueDate);
  expect(result.items).toHaveLength(4);
  expect(result.links.map(l => [l.firstLineNumber, l.lineCount])).toEqual([[1, 2], [3, 2]]);
  expect(result.items[0]).toMatchObject({ unitPriceExact: "1.8270", fmcg: { properties: { buyer_order_number: "BUYER-a", supplier_order_number: "OBJ-a", delivery_date: "2027-01-10", delivery_note_number: "DL-a" } } });
  expect(result.items[3].fmcg?.properties.buyer_order_number).toBe("BUYER-b");
  expect(calculateInvoice({ currency: "EUR", lines: result.items }).totalGrossCents).toBe(1594);
});
test.each([
  ["different client", { clientId: "other" }], ["different seller", { legalEntity: "SOLE_TRADER" }],
  ["undelivered", { status: "EXPEDOVANA" }], ["cancelled", { status: "ZRUSENA", shipmentStatus: "DELIVERED_EXTERNALLY" }],
  ["stale selection", { updatedAt: new Date("2027-01-22") }],
])("rejects %s", (_label, patch) => {
  expect(() => buildConsolidation([order("a"), { ...order("b"), ...patch }], [selection("a"), selection("b")], issueDate)).toThrow();
});
test("rejects duplicate orders, mixed months, future deliveries and invalid calendar dates", () => {
  const orders = [order("a"), order("b")];
  for (const selections of [[selection("a"), selection("a")], [selection("a"), { ...selection("b"), deliveryDate: "2027-02-01" }], [selection("a"), { ...selection("b"), deliveryDate: "2027-02-30" }]]) {
    expect(() => buildConsolidation(orders, selections, issueDate)).toThrow();
  }
  expect(() => buildConsolidation(orders, [selection("a"), selection("b", "20")], new Date("2027-01-19"))).toThrow("posledným dodaním");
});
test("source fingerprint detects price changes and ignores payment tracking changes", () => {
  const original = order("a");
  expect(sourceOrderHash({ ...original, platformSettlementCents: 100 })).toBe(sourceOrderHash(original));
  expect(sourceOrderHash({ ...original, items: original.items.map(i => ({ ...i, quantity: 4 })) })).not.toBe(sourceOrderHash(original));
});
test("supplier order date follows the Slovak calendar at midnight", () => {
  const result = buildConsolidation([{ ...order("a"), orderDate: new Date("2027-01-01T23:30:00Z") }, order("b")], [selection("a"), selection("b")], issueDate);
  expect(result.items[0].fmcg?.properties.supplier_order_date).toBe("2027-01-02");
});
test("single and summary invoice conflicts are checked under deterministic order locks", async () => {
  const findFirst = vi.fn().mockResolvedValue(null);
  const lock = vi.fn().mockResolvedValue([{ id: "order" }]);
  const tx = { $queryRaw: lock, invoice: { findFirst } } as unknown as Parameters<typeof lockUnbilledOrders>[0];
  await lockUnbilledOrders(tx, ["b", "a"], "VYDANA");
  expect(lock.mock.calls[0][0].values).toEqual(["a"]);
  expect(findFirst.mock.calls[0][0].where.OR).toEqual([{ orderId: "a" }, { orderLinks: { some: { orderId: "a" } } }]);
  findFirst.mockResolvedValue({ invoiceNumber: "2027001" });
  await expect(lockUnbilledOrders(tx, ["a"], "VYDANA")).rejects.toThrow("2027001");
});
