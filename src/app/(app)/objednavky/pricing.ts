export interface PriceableProduct {
  id: string;
  priceB2cCents: number;
  priceB2bCents: number | null;
}

export interface ClientPriceOverride {
  productId: string;
  unitPriceCents: number;
}

/**
 * B2C používa katalógovú cenu. B2B najprv používa dohodnutú cenu klienta a
 * legacy globálnu B2B cenu iba ako fallback. `null` znamená, že cenu musí
 * používateľ vedome doplniť; nikdy z toho nevznikne bezplatná objednávka.
 */
export function resolveUnitPriceCents(
  clientType: string,
  product: PriceableProduct,
  clientPrices: readonly ClientPriceOverride[],
): number | null {
  if (clientType === "B2C") return product.priceB2cCents;
  return clientPrices.find((price) => price.productId === product.id)?.unitPriceCents
    ?? product.priceB2bCents;
}
