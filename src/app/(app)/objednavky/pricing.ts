export interface PriceableProduct {
  id: string;
  priceB2cCents: number;
  priceB2bCents: number | null;
}

export interface ClientPriceOverride {
  productId: string;
  unitPriceCents: number;
}

export interface ClientPriceRuleInput {
  productId: string;
  effectiveFrom: string; // YYYY-MM-DD v Bratislave
  version: number;
  kind: string;
  unitPriceCents: number | null;
  discountBps: number | null;
}

export function slovakDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bratislava", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
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
  rules: readonly ClientPriceRuleInput[] = [],
  effectiveDate = slovakDateKey(),
): number | null {
  if (clientType === "B2C") return product.priceB2cCents;
  const base = clientPrices.find((price) => price.productId === product.id)?.unitPriceCents
    ?? product.priceB2bCents;
  const active = rules
    .filter((rule) => rule.productId === product.id && rule.effectiveFrom <= effectiveDate)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0];
  if (!active || active.kind === "DEFAULT") return base;
  if (active.kind === "FIXED") return active.unitPriceCents;
  if (active.kind === "DISCOUNT" && base !== null && active.discountBps !== null) {
    return Math.round(base * (10_000 - active.discountBps) / 10_000);
  }
  return null;
}

export function resolvePriceWithSource(
  clientType: string,
  product: PriceableProduct,
  clientPrices: readonly ClientPriceOverride[],
  rules: readonly ClientPriceRuleInput[] = [],
  effectiveDate = slovakDateKey(),
): { cents: number | null; source: "CLIENT" | "B2B" | "B2C" } {
  const cents = resolveUnitPriceCents(clientType, product, clientPrices, rules, effectiveDate);
  if (clientType === "B2C") return { cents, source: "B2C" };
  const active = rules.filter((rule) => rule.productId === product.id && rule.effectiveFrom <= effectiveDate)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0];
  return { cents, source: active && active.kind !== "DEFAULT" || clientPrices.some((price) => price.productId === product.id) ? "CLIENT" : "B2B" };
}
