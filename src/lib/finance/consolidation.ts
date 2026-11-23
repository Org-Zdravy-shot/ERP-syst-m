import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { CreateInvoiceDraftInput, InvoiceLineInput } from "./contracts";
import { fmcgPropertySchema, parseFmcgLine } from "./einvoice/fmcg";
import { FinanceDomainError } from "./domain";

export const consolidationSchema = z.array(z.object({
  orderId: z.string().min(1).max(100),
  expectedUpdatedAt: z.iso.datetime(),
  deliveryDate: fmcgPropertySchema.shape.delivery_date.unwrap(),
  buyerOrderNumber: fmcgPropertySchema.shape.buyer_order_number.unwrap(),
  deliveryNoteNumber: fmcgPropertySchema.shape.delivery_note_number,
})).min(2, "Vyberte aspoň dve objednávky.").max(50, "Jedna súhrnná faktúra môže obsahovať najviac 50 objednávok.");

export const sourceOrderInclude = { items: { include: { product: true }, orderBy: { id: "asc" as const } }, charges: { orderBy: { id: "asc" as const } } } satisfies Prisma.OrderInclude;
type SourceOrder = Prisma.OrderGetPayload<{ include: typeof sourceOrderInclude }>;

function localDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bratislava", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Lock in a deterministic order. Both single-order and consolidated drafts use this guard. */
export async function lockUnbilledOrders(tx: Prisma.TransactionClient, ids: string[], direction: string, throughDeliveryNote = false): Promise<void> {
  if (new Set(ids).size !== ids.length) throw new Error("Rovnaká objednávka je vybraná viackrát.");
  for (const id of [...ids].sort()) {
    const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`);
    if (locked.length !== 1) throw new Error("Vybraná objednávka neexistuje.");
    const linkedDelivery = { deliveryNoteLinks: { some: { deliveryNote: { orderId: id } } } };
    const existing = await tx.invoice.findFirst({ where: {
      direction, documentType: "INVOICE",
      OR: [
        { documentStatus: { not: "CANCELLED" }, OR: [{ orderId: id }, { orderLinks: { some: { orderId: id } } }, linkedDelivery] },
        ...(direction === "VYDANA" ? [{ documentStatus: "CANCELLED", finalizedAt: { not: null }, ...linkedDelivery }] : []),
      ],
    }, select: { invoiceNumber: true } });
    if (existing) throw new FinanceDomainError("INVALID_TRANSITION", `K objednávke už existuje ${existing.invoiceNumber ? `faktúra ${existing.invoiceNumber}` : "koncept faktúry"}.`);
    if (direction === "VYDANA" && !throughDeliveryNote) {
      const deliveryNote = await tx.deliveryNote.findFirst({ where: { orderId: id, cancelledAt: null }, select: { number: true } });
      if (deliveryNote) throw new FinanceDomainError("INVALID_TRANSITION", `Objednávka má dodací list ${deliveryNote.number}. Vytvorte faktúru z dodacieho listu.`);
    }
  }
}

/** Changes to payment tracking do not invalidate a draft; goods, prices and seller do. */
export function sourceOrderHash(order: SourceOrder): string {
  return createHash("sha256").update(JSON.stringify({
    clientId: order.clientId, legalEntity: order.legalEntity, orderNumber: order.orderNumber,
    orderDate: order.orderDate, status: order.status, shipmentStatus: order.shipmentStatus,
    items: [...order.items].sort((a, b) => a.id.localeCompare(b.id)).map(i => [i.id, i.productId, i.quantity, i.unitPriceCents, i.unitPriceExact?.toString(), i.vatRate, i.product.name, i.product.sku, i.product.unit]),
    charges: [...order.charges].filter(c => c.includedInSellerTotal).sort((a, b) => a.id.localeCompare(b.id)).map(c => [c.id, c.description, c.unitPriceCents, c.vatRate, c.taxTreatment]),
  })).digest("hex");
}

export function buildConsolidation(orders: SourceOrder[], raw: NonNullable<CreateInvoiceDraftInput["consolidation"]>, issueDate: Date) {
  const selections = consolidationSchema.parse(raw);
  if (new Set(selections.map(s => s.orderId)).size !== selections.length) throw new Error("Rovnaká objednávka je vybraná viackrát.");
  const dates = selections.map(s => s.deliveryDate).sort();
  if (dates[0].slice(0, 7) !== dates.at(-1)!.slice(0, 7)) throw new Error("Súhrnná faktúra môže zahŕňať dodania iba z jedného kalendárneho mesiaca.");
  const last = dates.at(-1)!;
  if (last > issueDate.toISOString().slice(0, 10)) throw new Error("Dátum vystavenia nesmie byť pred posledným dodaním.");
  const first = orders.find(o => o.id === selections[0].orderId);
  if (!first) throw new Error("Vybraná objednávka neexistuje.");
  const legalEntity = first.legalEntity;
  if (legalEntity !== "KURGI" && legalEntity !== "SOLE_TRADER") throw new Error("Objednávky musia mať overený právny subjekt.");
  const items: InvoiceLineInput[] = [];
  const links = selections.map(selection => {
    const order = orders.find(o => o.id === selection.orderId);
    if (!order) throw new Error("Vybraná objednávka neexistuje.");
    const fail = (message: string): never => { throw new Error(`Objednávka ${order.orderNumber}: ${message}`); };
    if (order.updatedAt.toISOString() !== selection.expectedUpdatedAt) fail("medzitým sa zmenila. Obnovte výber.");
    if (order.clientId !== first.clientId || order.legalEntity !== legalEntity) fail("všetky objednávky musia mať rovnakého odberateľa a právny subjekt.");
    if (order.status !== "DORUCENA" && order.shipmentStatus !== "DELIVERED_EXTERNALLY") fail("najprv potvrďte doručenie celej objednávky.");
    if (order.status === "ZRUSENA") fail("zrušenú objednávku nemožno fakturovať.");
    const fmcg = parseFmcgLine({ properties: {
      delivery_date: selection.deliveryDate, buyer_order_number: selection.buyerOrderNumber,
      supplier_order_number: order.orderNumber, supplier_order_date: localDate(order.orderDate),
      ...(selection.deliveryNoteNumber ? { delivery_note_number: selection.deliveryNoteNumber } : {}),
    } }, items.length + 1);
    const firstLineNumber = items.length + 1;
    const reference = ` / objednávka ${selection.buyerOrderNumber}${selection.deliveryNoteNumber ? ` / DL ${selection.deliveryNoteNumber}` : ""}`;
    items.push(...order.items.map(item => ({
      productId: item.productId, productSku: item.product.sku, description: `${item.product.name} (${item.product.sku})${reference}`,
      quantity: item.quantity, unit: item.product.unit, unitPriceCents: item.unitPriceCents,
      unitPriceExact: item.unitPriceExact?.toString(), vatRate: item.vatRate, fmcg,
    })), ...order.charges.filter(c => c.includedInSellerTotal).map(charge => ({
      description: `${charge.description}${reference}`, quantity: 1, unit: "ks", unitPriceCents: charge.unitPriceCents,
      vatRate: charge.vatRate, fmcg,
    })));
    if (firstLineNumber === items.length + 1) fail("nemá položky predajcu.");
    return { orderId: order.id, sourceHash: sourceOrderHash(order), firstLineNumber, lineCount: items.length - firstLineNumber + 1,
      deliveryDate: new Date(selection.deliveryDate), buyerOrderNumber: selection.buyerOrderNumber, deliveryNoteNumber: selection.deliveryNoteNumber ?? null };
  });
  return { clientId: first.clientId, legalEntity, items, links, from: new Date(dates[0]), to: new Date(last) };
}
