import { expect, test } from "vitest";
import { repriceDraftRows, restoreOrderDraft, storedOrderPriceInput } from "./draft";

test("po vytvorení produktu zachová klienta, dátum, kanál, poznámku, ručnú cenu a existujúcu položku", () => {
  const initial = { clientId: "", channel: "MANUAL", deliveryDate: "", note: "", submissionKey: "", rows: [{ productId: "" }] };
  const saved = { clientId: "gleistein", channel: "EMAIL", deliveryDate: "2026-11-04", note: "Dodať do 5.11.", submissionKey: "same-request", rows: [{ productId: "shot-60", quantity: "150", priceEur: "1,827", manual: true }] };
  const restored = restoreOrderDraft(initial, JSON.stringify(saved), "new-product", (productId) => ({ productId }));
  expect(restored).toMatchObject({ clientId: "gleistein", channel: "EMAIL", deliveryDate: "2026-11-04", note: "Dodať do 5.11.", submissionKey: "same-request" });
  expect(restored.rows).toEqual([saved.rows[0], { productId: "new-product" }]);
  expect(restoreOrderDraft(initial, JSON.stringify(restored), "new-product", (productId) => ({ productId })).rows).toHaveLength(2);
});

test("pri zrušení tvorby produktu obnoví pôvodný koncept bez ďalšej položky", () => {
  const draft = { clientId: "descanti", note: "Poznámka", submissionKey: "same", rows: [{ productId: "shot" }] };
  expect(restoreOrderDraft({ clientId: "", note: "", submissionKey: "", rows: [{ productId: "" }] }, JSON.stringify(draft), undefined, (productId) => ({ productId }))).toEqual(draft);
});

test("prepočet klienta alebo dátumu zachová ručnú cenu a obnoví iba cenníkové riadky", () => {
  const rows = [
    { productId: "manual", priceEur: "1,827", priceSource: "MANUAL", manual: true },
    { productId: "catalog", priceEur: "2,00", priceSource: "B2B", manual: false },
  ];
  const next = repriceDraftRows(rows, () => ({ priceEur: "2,20", priceSource: "CLIENT" }));
  expect(next[0]).toEqual(rows[0]);
  expect(next[1]).toMatchObject({ priceEur: "2,20", priceSource: "CLIENT" });
});

test("opätovné otvorenie uloženej položky Gleistein zachová 1,827 €", () => {
  expect(storedOrderPriceInput({ unitPriceCents: 183, unitPriceExact: { toString: () => "1.8270" } })).toBe("1,827");
  expect(storedOrderPriceInput({ unitPriceCents: 183, unitPriceExact: null })).toBe("1,83");
});

test("koncept Zľavomat zachová subjekt, pôvodný dátum, platbu, odoslanie a dopravu pri návrate", () => {
  const initial = { clientId: "", legalEntity: "", orderDate: "", externalId: "", platformPaymentStatus: "", shipmentStatus: "", shippedAt: "", submissionKey: "", charges: [], rows: [{ productId: "" }] };
  const saved = { ...initial, clientId: "customer", legalEntity: "SOLE_TRADER", orderDate: "2026-10-26", externalId: "33404506", platformPaymentStatus: "CUSTOMER_PAID", shipmentStatus: "SHIPPED_EXTERNALLY", shippedAt: "2026-10-27", submissionKey: "stable", charges: [{ recipient: "PLATFORM", priceEur: "2,99" }], rows: [{ productId: "shot" }] };
  const reopened = restoreOrderDraft(initial, JSON.stringify(saved), undefined, (productId) => ({ productId }));
  expect(reopened).toEqual(saved);
});
