import { prisma } from "./prisma";

export interface MonthlyActuals {
  revenueCents: number; // vydané doklady + eKasa bez priradenej faktúry
  productionUnits: number; // kusy z hotových šarží
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}`;
}

/**
 * Skutočnosť po mesiacoch — počíta sa vždy live, nič sa nekešuje.
 * Evidované predaje = finalizované vydané faktúry mínus dobropisy podľa issueDate
 * + eKasa bez priradenej faktúry podľa saleDate. Nepárovaný rovnaký predaj môže zostať duplicitný.
 * Výroba = producedQty hotových (DONE) šarží podľa productionDate.
 */
export async function getMonthlyActualsMap(): Promise<Map<string, MonthlyActuals>> {
  const [invoices, ekasa, batches] = await Promise.all([
    prisma.invoice.findMany({
      where: { direction: "VYDANA", documentStatus: "ISSUED" },
      select: { issueDate: true, documentType: true, totalGrossCents: true },
    }),
    prisma.ekasaSale.findMany({ where: { matchedInvoiceId: null }, select: { saleDate: true, totalGrossCents: true } }),
    prisma.productionBatch.findMany({
      where: { status: "DONE" },
      select: { productionDate: true, producedQty: true },
    }),
  ]);

  const map = new Map<string, MonthlyActuals>();
  const bucket = (key: string) => {
    let entry = map.get(key);
    if (!entry) {
      entry = { revenueCents: 0, productionUnits: 0 };
      map.set(key, entry);
    }
    return entry;
  };

  for (const inv of invoices) {
    bucket(monthKey(inv.issueDate)).revenueCents +=
      inv.totalGrossCents * (inv.documentType === "CREDIT_NOTE" ? -1 : 1);
  }
  for (const sale of ekasa) bucket(monthKey(sale.saleDate)).revenueCents += sale.totalGrossCents;
  for (const b of batches) bucket(monthKey(b.productionDate)).productionUnits += b.producedQty;

  return map;
}

export function actualsFor(map: Map<string, MonthlyActuals>, year: number, month: number): MonthlyActuals {
  return map.get(`${year}-${month}`) ?? { revenueCents: 0, productionUnits: 0 };
}

/** Plnenie v % (0–999, zaokrúhlené); null ak cieľ nie je nastavený. */
export function fulfillmentPct(actual: number, target: number): number | null {
  if (target <= 0) return null;
  return Math.min(999, Math.round((actual / target) * 100));
}
