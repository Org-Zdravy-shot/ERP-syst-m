import { expect, test } from "vitest";
import {
  supplierAccountEntrySchema,
  supplierCatalogItemSchema,
  supplierLocationSchema,
  supplierPriceSchema,
  supplierReturnableMovementSchema,
  supplierSchema,
} from "@/lib/zod-schemas";

test("dodávateľ prijme osobu aj firmu, ale odmietne neplatné kontaktné údaje", () => {
  expect(
    supplierSchema.safeParse({
      kind: "COMPANY",
      name: "Včelárstvo",
      email: "med@example.sk",
      website: "https://example.sk",
      paymentTermsDays: 30,
      currency: "EUR",
      source: "REFERRAL",
      rating: 5,
    }).success,
  ).toBe(true);
  expect(
    supplierSchema.safeParse({
      kind: "COMPANY",
      name: "Včelárstvo",
      email: "nie-je-email",
      paymentTermsDays: -1,
      currency: "EUR",
      source: "OTHER",
    }).success,
  ).toBe(false);
  expect(
    supplierSchema.safeParse({
      kind: "COMPANY",
      name: "Včelárstvo",
      website: "javascript:alert(1)",
      paymentTermsDays: 14,
      currency: "EUR",
      source: "OTHER",
    }).success,
  ).toBe(false);
});

test("ponuka môže byť služba alebo jedna skladová položka, nikdy obe", () => {
  const base = {
    name: "Med 30 kg",
    unit: "kg",
    packQuantity: 30,
    minOrderQuantity: 30,
    orderMultiple: 30,
    leadTimeDays: 7,
  };
  expect(supplierCatalogItemSchema.safeParse(base).success).toBe(true);
  expect(supplierCatalogItemSchema.safeParse({ ...base, materialId: "m1" }).success).toBe(true);
  expect(
    supplierCatalogItemSchema.safeParse({ ...base, materialId: "m1", productId: "p1" }).success,
  ).toBe(false);
});

test("cenová platnosť a geografické súradnice majú bezpečné hranice", () => {
  expect(
    supplierPriceSchema.safeParse({
      unitPriceCents: 450,
      pricePerQuantity: 1,
      minimumQuantity: 0,
      currency: "EUR",
      priceType: "NET",
      vatRate: 23,
      validFrom: new Date("2026-09-01"),
      validTo: new Date("2026-08-01"),
    }).success,
  ).toBe(false);
  expect(
    supplierLocationSchema.safeParse({
      type: "PICKUP",
      name: "Farma",
      country: "sk",
      latitude: 91,
    }).success,
  ).toBe(false);
});

test("ledger pohyby musia byť nenulové, ale môžu ísť oboma smermi", () => {
  const at = new Date("2026-08-18");
  const before = new Date("2026-08-17");
  expect(supplierReturnableMovementSchema.safeParse({ quantity: -2, occurredAt: at }).success).toBe(true);
  expect(supplierReturnableMovementSchema.safeParse({ quantity: 0, occurredAt: at }).success).toBe(false);
  expect(
    supplierReturnableMovementSchema.safeParse({ quantity: 2, occurredAt: at, dueDate: before }).success,
  ).toBe(false);
  expect(
    supplierAccountEntrySchema.safeParse({ type: "CREDIT", amountCents: -2_000, occurredAt: at }).success,
  ).toBe(true);
  expect(
    supplierAccountEntrySchema.safeParse({ type: "CREDIT", amountCents: 0, occurredAt: at }).success,
  ).toBe(false);
  expect(
    supplierAccountEntrySchema.safeParse({
      type: "DEPOSIT",
      amountCents: 2_000,
      occurredAt: at,
      dueDate: before,
    }).success,
  ).toBe(false);
});
