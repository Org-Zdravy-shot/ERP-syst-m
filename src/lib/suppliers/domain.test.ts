import { expect, test } from "vitest";
import {
  assertSupplierOrderTransition,
  calculateSupplierOrderTotals,
  canTransitionSupplierOrder,
  deriveSupplierOrderReceiptStatus,
  recommendedOrderQuantity,
  selectActiveSupplierPrice,
  SupplierDomainError,
  supplierInvoiceBalance,
  supplierManualAccountBalance,
  supplierReturnableBalance,
} from "./domain";

test("nákupná objednávka povoľuje iba definované prechody", () => {
  expect(canTransitionSupplierOrder("DRAFT", "APPROVED")).toBe(true);
  expect(canTransitionSupplierOrder("APPROVED", "SENT")).toBe(true);
  expect(canTransitionSupplierOrder("RECEIVED", "CANCELLED")).toBe(false);
  expect(() => assertSupplierOrderTransition("PARTIALLY_RECEIVED", "CANCELLED")).toThrow(
    SupplierDomainError,
  );
});

test("netto a brutto nákupné ceny sa prepočítajú po riadkoch", () => {
  const result = calculateSupplierOrderTotals(
    [
      { quantity: 2, unitPriceCents: 1_000, priceType: "NET", vatRate: 23 },
      { quantity: 1, unitPriceCents: 1_230, priceType: "GROSS", vatRate: 23 },
    ],
    500,
    100,
  );
  expect(result.lines[0]).toMatchObject({ totalNetCents: 2_000, totalVatCents: 460, totalGrossCents: 2_460 });
  expect(result.lines[1]).toMatchObject({ totalNetCents: 1_000, totalVatCents: 230, totalGrossCents: 1_230 });
  expect(result.totalGrossCents).toBe(4_090);
});

test("množstevná cena vyberie najvyšší platný stupeň", () => {
  const prices = [
    { id: "base", unitPriceCents: 500, minimumQuantity: 0, validFrom: new Date("2026-01-01") },
    { id: "bulk", unitPriceCents: 450, minimumQuantity: 20, validFrom: new Date("2026-01-01") },
    { id: "future", unitPriceCents: 400, minimumQuantity: 20, validFrom: new Date("2027-01-01") },
  ];
  expect(selectActiveSupplierPrice(prices, 25, new Date("2026-08-18"))?.id).toBe("bulk");
  expect(selectActiveSupplierPrice(prices, 10, new Date("2026-08-18"))?.id).toBe("base");
});

test("doobjednanie odpočíta otvorenú objednávku a rešpektuje balenie", () => {
  expect(
    recommendedOrderQuantity({
      currentQuantity: 7,
      openOrderQuantity: 0,
      minStock: 10,
      targetStock: 30,
      minOrderQuantity: 12,
      packQuantity: 6,
      orderMultiple: 4,
    }),
  ).toBe(24);
  expect(
    recommendedOrderQuantity({
      currentQuantity: 7,
      openOrderQuantity: 5,
      minStock: 10,
      targetStock: 30,
      minOrderQuantity: 12,
      packQuantity: 6,
      orderMultiple: 4,
    }),
  ).toBe(0);
});

test("vratné nádoby fungujú ako obojsmerný pohybový ledger", () => {
  expect(supplierReturnableBalance([4, 3, -2, -5])).toBe(0);
  expect(() => supplierReturnableBalance([0])).toThrow(SupplierDomainError);
});

test("finančný zostatok oddeľuje faktúry od ručných dohôd", () => {
  const invoiceBalance = supplierInvoiceBalance([
    { documentType: "INVOICE", documentStatus: "ISSUED", totalGrossCents: 10_000, allocatedCents: 4_000 },
    { documentType: "CREDIT_NOTE", documentStatus: "ISSUED", totalGrossCents: 1_000, allocatedCents: 0 },
    { documentType: "INVOICE", documentStatus: "CANCELLED", totalGrossCents: 5_000, allocatedCents: 0 },
  ]);
  expect(invoiceBalance).toBe(5_000);
  expect(supplierManualAccountBalance([2_000, -500, -2_500])).toBe(-1_000);
});

test("čiastočný príjem sa odvodí zo súčtov a nadpríjem sa odmietne", () => {
  expect(
    deriveSupplierOrderReceiptStatus([
      { orderedQuantity: 10, receivedQuantity: 10 },
      { orderedQuantity: 5, receivedQuantity: 2 },
    ]),
  ).toBe("PARTIALLY_RECEIVED");
  expect(
    deriveSupplierOrderReceiptStatus([
      { orderedQuantity: 10, receivedQuantity: 10 },
      { orderedQuantity: 5, receivedQuantity: 5 },
    ]),
  ).toBe("RECEIVED");
  expect(() =>
    deriveSupplierOrderReceiptStatus([{ orderedQuantity: 5, receivedQuantity: 6 }]),
  ).toThrow(SupplierDomainError);
});
