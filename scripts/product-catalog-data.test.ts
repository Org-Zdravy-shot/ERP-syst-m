import { describe, expect, it } from "vitest";
import { PRODUCT_CATALOG } from "./product-catalog-data";

describe("produkčný katalóg", () => {
  it("obsahuje tri príchute vo všetkých štyroch objemoch", () => {
    expect(PRODUCT_CATALOG).toHaveLength(12);
    expect(new Set(PRODUCT_CATALOG.map((product) => product.sku)).size).toBe(12);
    expect(new Set(PRODUCT_CATALOG.map((product) => product.volumeMl))).toEqual(
      new Set([40, 200, 500, 1_000]),
    );
  });

  it("kopíruje aktuálne B2C ceny webu pre každý objem", () => {
    const prices = new Map(PRODUCT_CATALOG.map((product) => [product.volumeMl, product.priceB2cCents]));
    expect(prices).toEqual(new Map([[40, 350], [200, 1_050], [500, 2_500], [1_000, 4_500]]));
  });

  it("neobsahuje vymyslenú B2B cenu", () => {
    expect(PRODUCT_CATALOG.every((product) => !("priceB2bCents" in product))).toBe(true);
  });

  it("do potvrdenej registrácie nevytvára na objednávkach DPH", () => {
    expect(PRODUCT_CATALOG.every((product) => product.vatRate === 0)).toBe(true);
  });
});
