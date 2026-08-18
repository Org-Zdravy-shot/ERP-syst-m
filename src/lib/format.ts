// Formátovanie pre slovenské UI — peniaze VŽDY cez tieto funkcie (centy → EUR).

const eur = new Intl.NumberFormat("sk-SK", { style: "currency", currency: "EUR" });
const skDate = new Intl.DateTimeFormat("sk-SK", { dateStyle: "medium" });
const skDateTime = new Intl.DateTimeFormat("sk-SK", { dateStyle: "medium", timeStyle: "short" });
const skNumber = new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 3 });

export function formatCents(cents: number): string {
  return eur.format(cents / 100);
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return skDate.format(typeof date === "string" ? new Date(date) : date);
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return skDateTime.format(typeof date === "string" ? new Date(date) : date);
}

export function formatQty(qty: number, unit?: string): string {
  return `${skNumber.format(qty)}${unit ? ` ${unit}` : ""}`;
}

/** "12,50" alebo "12.50" (EUR) → centy */
export function parseEurToCents(value: string): number {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`Neplatná suma: ${value}`);
  }
  const parsed = Number(normalized);
  const cents = Math.round(parsed * 100);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(cents)) {
    throw new Error(`Neplatná suma: ${value}`);
  }
  return cents;
}

export const MONTH_NAMES_SK = [
  "Január", "Február", "Marec", "Apríl", "Máj", "Jún",
  "Júl", "August", "September", "Október", "November", "December",
];
