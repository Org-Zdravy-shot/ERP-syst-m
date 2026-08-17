import { describe, expect, it } from "vitest";
import { resolveUnitPriceCents } from "./pricing";

const product = {
  id: "product-1",
  priceB2cCents: 1_050,
  priceB2bCents: 800,
};

describe("resolveUnitPriceCents", () => {
  it("použije B2C cenu z katalógu", () => {
    expect(resolveUnitPriceCents("B2C", product, [{ productId: product.id, unitPriceCents: 700 }]))
      .toBe(1_050);
  });

  it("uprednostní dohodnutú cenu B2B klienta", () => {
    expect(resolveUnitPriceCents("B2B", product, [{ productId: product.id, unitPriceCents: 725 }]))
      .toBe(725);
  });

  it("zachová legacy predvolenú B2B cenu ako fallback", () => {
    expect(resolveUnitPriceCents("B2B", product, [])).toBe(800);
  });

  it("vráti null, ak B2B cena nie je nastavená", () => {
    expect(resolveUnitPriceCents("B2B", { ...product, priceB2bCents: null }, [])).toBeNull();
  });
});
