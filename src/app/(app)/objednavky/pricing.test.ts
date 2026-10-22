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

  it("platná verzia má prednosť a budúca cena ešte neplatí", () => {
    const rules = [
      { productId: product.id, effectiveFrom: "2026-10-22", version: 1, kind: "FIXED", unitPriceCents: 650, discountBps: null },
      { productId: product.id, effectiveFrom: "2026-11-01", version: 2, kind: "FIXED", unitPriceCents: 600, discountBps: null },
    ];
    expect(resolveUnitPriceCents("B2B", product, [], rules, "2026-10-31")).toBe(650);
    expect(resolveUnitPriceCents("B2B", product, [], rules, "2026-11-01")).toBe(600);
  });

  it("zľavu počíta z dohodnutej základnej B2B ceny v celých centoch", () => {
    const rules = [{ productId: product.id, effectiveFrom: "2026-10-22", version: 1, kind: "DISCOUNT", unitPriceCents: null, discountBps: 1250 }];
    expect(resolveUnitPriceCents("B2B", product, [{ productId: product.id, unitPriceCents: 725 }], rules, "2026-10-22")).toBe(634);
    expect(resolveUnitPriceCents("B2B", { ...product, priceB2bCents: null }, [], rules, "2026-10-22")).toBeNull();
  });

  it("nová verzia v ten istý deň a DEFAULT vrátia základný cenník", () => {
    const rules = [
      { productId: product.id, effectiveFrom: "2026-10-22", version: 1, kind: "FIXED", unitPriceCents: 650, discountBps: null },
      { productId: product.id, effectiveFrom: "2026-10-22", version: 2, kind: "DEFAULT", unitPriceCents: null, discountBps: null },
    ];
    expect(resolveUnitPriceCents("B2B", product, [], rules, "2026-10-22")).toBe(800);
  });
});
