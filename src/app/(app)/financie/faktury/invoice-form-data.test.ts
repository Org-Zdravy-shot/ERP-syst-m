import { expect, test } from "vitest";
import type { Invoice, InvoiceItem } from "@prisma/client";
import { invoiceFormInitial } from "./invoice-form-data";

const source = {
  legalEntity: "KURGI", clientId: "client", issueDate: new Date("2026-11-01"), dueDate: new Date("2026-11-15"), deliveryDate: new Date("2026-11-01"), updatedAt: new Date("2026-11-21T10:00:00.000Z"),
  variableSymbol: "1234", externalNumber: "EXT-1", buyerReference: "BUYER-OLD", note: "Poznámka",
  items: [{ productId: "product", productSku: "SKU", lineNumber: 1, description: "Shot", quantity: 5, unit: "ks", unitPriceCents: 183, unitPriceExact: { toString: () => "1.8270" }, vatRate: 23, taxCategory: "STANDARD", fmcgSnapshot: { gtin: "8589000072245", properties: { item_type: "Z", units_per_carton: "12", batch_number: "OLD-LOT", expiry_date: "2027-01-31", buyer_order_number: "OLD-ORDER", delivery_note_number: "OLD-DL", vat_amount: "2.10", recycling_fee_amount: "0.50" } } }],
} as unknown as Invoice & { items: InvoiceItem[] };

test("copy preserves precise prices but resets identifiers, dates and shipment metadata", () => {
  const result = invoiceFormInitial(source, "copy", new Date("2026-11-21T23:30:00.000Z"));
  expect(result).toMatchObject({ issueDate: "2026-11-22", deliveryDate: "2026-11-22", dueDate: "2026-12-06", variableSymbol: "", externalNumber: "", buyerReference: "", clientId: "client" });
  expect(result.expectedUpdatedAt).toBeUndefined();
  expect(result.lines[0]).toMatchObject({ productId: "product", unitPrice: "1.8270", fmcg: { gtin: "8589000072245", properties: { item_type: "Z", units_per_carton: "12" } } });
  expect(Object.keys(result.lines[0].fmcg!.properties)).toEqual(["item_type", "units_per_carton"]);
});

test("editing preserves all captured references and the concurrency version", () => {
  const result = invoiceFormInitial(source, "edit");
  expect(result).toMatchObject({ buyerReference: "BUYER-OLD", variableSymbol: "1234", issueDate: "2026-11-01", expectedUpdatedAt: "2026-11-21T10:00:00.000Z" });
  expect(result.lines[0].fmcg).toEqual(source.items[0].fmcgSnapshot);
});

test("legacy negative cents do not turn into a positive amount when copied", () => {
  const result = invoiceFormInitial({ ...source, items: [{ ...source.items[0], unitPriceExact: null, unitPriceCents: -1 }] }, "copy");
  expect(result.lines[0].unitPrice).toBe("-0.01");
});
