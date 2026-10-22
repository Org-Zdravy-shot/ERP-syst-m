import { describe, expect, it } from "vitest";
import { mapWooOrder, wooMoneyToCents, wooOrderSchema } from "./mapper";

const base = {
  id: 42, number: "42", status: "processing", currency: "EUR",
  billing: { first_name: "Jana", last_name: "Nová", email: "jana@example.test" },
  line_items: [{ sku: "SHOT-60", name: "Shot", quantity: 2, total: "6.00", total_tax: "1.20" }],
  shipping_total: "0.00", shipping_tax: "0.00", total: "7.20", total_tax: "1.20",
};
const product = [{ id: "p1", sku: "SHOT-60", name: "Shot", vatRate: 20, isActive: true }];

describe("WooCommerce order mapping", () => {
  it("overí sumy a priradí objednávku podľa SKU", () => {
    const order = wooOrderSchema.parse(base);
    expect(mapWooOrder(order, product)).toEqual({ lines: [{ productId: "p1", quantity: 2, unitPriceCents: 300, vatRate: 20 }], charges: [] });
  });
  it("rozdelí zľavnený riadok na centovo presné jednotky", () => {
    const order = wooOrderSchema.parse({ ...base, line_items: [{ ...base.line_items[0], quantity: 3, total: "10.00", total_tax: "2.00" }], total: "12.00", total_tax: "2.00" });
    expect(mapWooOrder(order, product).lines).toEqual([
      { productId: "p1", quantity: 2, unitPriceCents: 333, vatRate: 20 },
      { productId: "p1", quantity: 1, unitPriceCents: 334, vatRate: 20 },
    ]);
  });
  it("pridá dopravu k sume bez skladového produktu", () => {
    const order = wooOrderSchema.parse({ ...base, shipping_total: "3.00", shipping_tax: "0.60", total: "10.80", total_tax: "1.80" });
    expect(mapWooOrder(order, product).charges).toEqual([{ kind: "SHIPPING", description: "Doprava", unitPriceCents: 300, vatRate: 20 }]);
  });
  it("neimportuje neznáme SKU ani nesúlad DPH", () => {
    expect(() => mapWooOrder(wooOrderSchema.parse(base), [])).toThrow("SKU");
    expect(() => mapWooOrder(wooOrderSchema.parse(base), [{ ...product[0], vatRate: 23 }])).toThrow("DPH");
  });
  it("neakceptuje stratu presnosti pri sume", () => {
    expect(wooMoneyToCents("3.5000")).toBe(350);
    expect(() => wooMoneyToCents("3.5010")).toThrow();
  });
});
