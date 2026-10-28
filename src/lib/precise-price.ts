/** Four decimal places in EUR, stored as an exact decimal string in the database. */
export function parseUnitPrice(value: string): string {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) throw new Error("Zadajte platnú cenu s najviac 4 desatinnými miestami.");
  const [euros, fraction = ""] = normalized.split(".");
  const units = Number(euros) * 10_000 + Number(fraction.padEnd(4, "0"));
  if (!Number.isSafeInteger(units) || units > 100_000_000_000) throw new Error("Cena je mimo povoleného rozsahu.");
  return `${Math.floor(units / 10_000)}.${String(units % 10_000).padStart(4, "0")}`;
}

export function priceUnits(value: string): number {
  const [euros, fraction] = parseUnitPrice(value).split(".");
  return Number(euros) * 10_000 + Number(fraction);
}

/** Half up to cents; the unit price is multiplied before rounding. */
export function lineNetCents(quantity: number, exact: string): number {
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Neplatné množstvo.");
  const quantityText = String(quantity);
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(quantityText);
  if (!match) throw new Error("Množstvo môže mať najviac 6 desatinných miest.");
  const decimals = match[2]?.length ?? 0;
  const scale = BigInt(10) ** BigInt(decimals);
  const quantityUnits = BigInt(match[1]) * scale + BigInt(match[2] ?? 0);
  const denominator = BigInt(100) * scale;
  const result = (BigInt(priceUnits(exact)) * quantityUnits + denominator / BigInt(2)) / denominator;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Suma je mimo povoleného rozsahu.");
  return Number(result);
}

export function unitPriceCents(exact: string): number {
  return lineNetCents(1, exact);
}

export function formatUnitPrice(exact: string): string {
  return parseUnitPrice(exact).replace(".", ",").replace(/0+$/, "").replace(/,$/, "");
}
