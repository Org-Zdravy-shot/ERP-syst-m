import { prisma } from "./prisma";

export interface PeriodActuals {
  invoicedGrossCents: number;
  invoicedNetCents: number;
  ekasaGrossCents: number;
  costsNetCents: number;
  cashInCents: number;
  cashOutCents: number;
  productionUnits: number;
}

export const emptyPeriodActuals = (): PeriodActuals => ({
  invoicedGrossCents: 0,
  invoicedNetCents: 0,
  ekasaGrossCents: 0,
  costsNetCents: 0,
  cashInCents: 0,
  cashOutCents: 0,
  productionUnits: 0,
});

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayInSlovakia(): Date {
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bratislava", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parsePlanDate(date)!;
}

export function parsePlanDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || isoDate(date) !== value ? null : date;
}

export function nextUtcDay(date: Date): Date {
  return new Date(date.getTime() + 86_400_000);
}

export function planProgress(start: Date, end: Date, today: Date): number {
  const todayDate = parsePlanDate(isoDate(today))!;
  const elapsed = nextUtcDay(todayDate).getTime() - start.getTime();
  const duration = nextUtcDay(end).getTime() - start.getTime();
  return Math.max(0, Math.min(1, elapsed / duration));
}

export function addActuals(total: PeriodActuals, part: PeriodActuals): PeriodActuals {
  return {
    invoicedGrossCents: total.invoicedGrossCents + part.invoicedGrossCents,
    invoicedNetCents: total.invoicedNetCents + part.invoicedNetCents,
    ekasaGrossCents: total.ekasaGrossCents + part.ekasaGrossCents,
    costsNetCents: total.costsNetCents + part.costsNetCents,
    cashInCents: total.cashInCents + part.cashInCents,
    cashOutCents: total.cashOutCents + part.cashOutCents,
    productionUnits: total.productionUnits + part.productionUnits,
  };
}

/** Only posted EUR documents and recorded EUR payments. The end date is inclusive. */
export async function getPeriodActuals(start: Date, end: Date) {
  const range = { gte: start, lt: nextUtcDay(end) };
  const [invoices, sales, payments, batches] = await Promise.all([
    prisma.invoice.findMany({
      where: { documentStatus: "ISSUED", currency: "EUR", issueDate: range },
      select: { direction: true, documentType: true, issueDate: true, totalGrossCents: true, totalNetCents: true },
    }),
    prisma.ekasaSale.findMany({ where: { saleDate: range }, select: { saleDate: true, totalGrossCents: true } }),
    prisma.payment.findMany({
      where: { currency: "EUR", paidAt: range },
      select: { direction: true, paidAt: true, amountCents: true },
    }),
    prisma.productionBatch.findMany({
      where: { status: "DONE", productionDate: range },
      select: { productionDate: true, producedQty: true },
    }),
  ]);

  const byMonth = new Map<string, PeriodActuals>();
  const bucket = (date: Date) => {
    const key = isoDate(date).slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, emptyPeriodActuals());
    return byMonth.get(key)!;
  };
  for (const invoice of invoices) {
    const actual = bucket(invoice.issueDate);
    const sign = invoice.documentType === "CREDIT_NOTE" ? -1 : 1;
    if (invoice.direction === "VYDANA") {
      actual.invoicedGrossCents += sign * invoice.totalGrossCents;
      actual.invoicedNetCents += sign * invoice.totalNetCents;
    } else if (invoice.direction === "PRIJATA") {
      actual.costsNetCents += sign * invoice.totalNetCents;
    }
  }
  for (const sale of sales) bucket(sale.saleDate).ekasaGrossCents += sale.totalGrossCents;
  for (const payment of payments) {
    const actual = bucket(payment.paidAt);
    if (payment.direction === "INCOMING") actual.cashInCents += payment.amountCents;
    else if (payment.direction === "OUTGOING") actual.cashOutCents += payment.amountCents;
  }
  for (const batch of batches) bucket(batch.productionDate).productionUnits += batch.producedQty;

  const total = [...byMonth.values()].reduce(addActuals, emptyPeriodActuals());
  return { total, byMonth };
}
