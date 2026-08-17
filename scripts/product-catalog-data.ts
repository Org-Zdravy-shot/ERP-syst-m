export interface ProductCatalogItem {
  sku: string;
  name: string;
  volumeMl: number;
  priceB2cCents: number;
  vatRate: number;
  shelfLifeDays: number;
}

const VOLUMES = [
  { volumeMl: 40, code: "040", priceB2cCents: 350 },
  { volumeMl: 200, code: "200", priceB2cCents: 1_050 },
  { volumeMl: 500, code: "500", priceB2cCents: 2_500 },
  { volumeMl: 1_000, code: "1000", priceB2cCents: 4_500 },
] as const;

const FLAVOURS = [
  { code: "KLA", name: "Ginger shot – Klasik", shelfLifeDays: 60 },
  { code: "CVK", name: "Ginger shot – Cvikla", shelfLifeDays: 60 },
  { code: "ANS", name: "Ginger shot – Ananás a škorica", shelfLifeDays: 45 },
] as const;

export const PRODUCT_CATALOG: readonly ProductCatalogItem[] = FLAVOURS.flatMap((flavour) =>
  VOLUMES.map((volume) => ({
    sku: `ZS-${flavour.code}-${volume.code}`,
    name: `${flavour.name} ${volume.volumeMl} ml`,
    volumeMl: volume.volumeMl,
    priceB2cCents: volume.priceB2cCents,
    // Aktuálne je podnikateľ pri domácich dodaniach neplatiteľ. Sadzba 23 %
    // sa zapne až časovo platnou a účtovníkom potvrdenou ProductVatRate.
    vatRate: 0,
    shelfLifeDays: flavour.shelfLifeDays,
  })),
);
