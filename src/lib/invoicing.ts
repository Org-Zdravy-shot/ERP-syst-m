import type { Prisma } from "@prisma/client";
import { formatDocumentNumber, type DocumentNumberKind } from "./finance/domain";
import { lineNetCents } from "./precise-price";

type Tx = Prisma.TransactionClient;

/**
 * Transakčne bezpečné číslovanie dokladov.
 * counterId napr. "VYDANA-2026" → "FA2026001", "PRIJATA-2026" → "PF2026001",
 * "OBJ-2026" → "OBJ2026-0001", "SARZA-2026" → "S2026-0001",
 * "NAKUP-2026" → "NO2026001".
 * VŽDY volať vnútri prisma.$transaction — inak hrozia duplikáty.
 */
export async function nextNumber(tx: Tx, kind: DocumentNumberKind, year: number): Promise<string> {
  const counterId = `${kind}-${year}`;
  const counter = await tx.docCounter.upsert({
    where: { id: counterId },
    create: { id: counterId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return formatDocumentNumber(kind, year, counter.lastNumber);
}

/** Nové rady sú oddelené podľa subjektu; pôvodné čísla zostávajú bez zmeny. */
export async function nextEntityNumber(tx: Tx, kind: "OBJ" | "VYDANA", year: number, entity: "SOLE_TRADER" | "KURGI"): Promise<string> {
  const marker = entity === "SOLE_TRADER" ? "Z" : "K";
  const counterId = `${kind}-${marker}-${year}`;
  const counter = await tx.docCounter.upsert({
    where: { id: counterId },
    create: { id: counterId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return kind === "OBJ"
    ? `OBJ${marker}${year}-${String(counter.lastNumber).padStart(4, "0")}`
    : `FA${marker}${year}${String(counter.lastNumber).padStart(3, "0")}`;
}

export interface LineInput {
  quantity: number;
  unitPriceCents: number;
  unitPriceExact?: string | { toString(): string } | null;
  vatRate: number; // 20 = 20 %
}

export interface Totals {
  totalNetCents: number;
  totalVatCents: number;
  totalGrossCents: number;
}

/** DPH sa počíta a zaokrúhľuje per riadok, potom sa sčítava. */
export function computeTotals(lines: LineInput[]): Totals {
  let totalNetCents = 0;
  let totalVatCents = 0;
  for (const line of lines) {
    const net = line.unitPriceExact ? lineNetCents(line.quantity, String(line.unitPriceExact)) : Math.round(line.quantity * line.unitPriceCents);
    const vat = Math.round((net * line.vatRate) / 100);
    totalNetCents += net;
    totalVatCents += vat;
  }
  return { totalNetCents, totalVatCents, totalGrossCents: totalNetCents + totalVatCents };
}

export const INVOICE_STATUSES = ["VYSTAVENA", "UHRADENA", "PO_SPLATNOSTI", "STORNO"] as const;
export const INVOICE_SOURCES = ["INTERNA", "WEB", "SUPERFAKTURA", "OMEGA", "HISTORICAL"] as const;
export type InvoiceSource = (typeof INVOICE_SOURCES)[number];

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  VYSTAVENA: "Vystavená",
  UHRADENA: "Uhradená",
  PO_SPLATNOSTI: "Po splatnosti",
  STORNO: "Storno",
};

export const INVOICE_SOURCE_LABELS: Record<string, string> = {
  INTERNA: "Interná",
  WEB: "Web",
  SUPERFAKTURA: "SuperFaktúra",
  OMEGA: "Omega",
  HISTORICAL: "Historický originál",
};
