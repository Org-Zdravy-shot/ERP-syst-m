import { Prisma, type DeliveryNote } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextEntityNumber } from "@/lib/invoicing";
import { financePartySnapshotSchema } from "@/lib/zod-schemas";
import { parseUnitPrice, unitPriceCents } from "@/lib/precise-price";
import { isVatPayerAtDate } from "../domain";
import { lockUnbilledOrders, sourceOrderHash, sourceOrderInclude } from "../consolidation";
import { parseFmcgLine } from "../einvoice/fmcg";
import type { InvoiceLineInput } from "../contracts";
import { billingParty, quoteForConversion } from "../quotes/service";
import { deliveryLinesSchema, invoiceDeliveryNotesSchema, invoiceKeepsDelivery, issueDeliveryNoteSchema, type DeliveryNoteInput, type InvoiceDeliverySelection } from "./schema";

type Tx = Prisma.TransactionClient;
type SourceOrder = Prisma.OrderGetPayload<{ include: typeof sourceOrderInclude }>;
const localDate = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bratislava" }).format(date);
export const dateKey = (date: Date) => date.toISOString().slice(0, 10);

function deliveryOrderHash(order: SourceOrder): string {
  return sourceOrderHash({ ...order, status: "EXPEDOVANA", shipmentStatus: null });
}

export function canCreateDeliveryFromInvoice(invoice: {
  direction: string; documentType: string; documentStatus: string; currency: string;
  clientId: string | null; finalizedAt: Date | null; issuerSnapshot: unknown; counterpartySnapshot: unknown;
}) {
  return invoice.direction === "VYDANA" && invoice.documentType === "INVOICE" && invoice.documentStatus === "ISSUED" &&
    invoice.currency === "EUR" && !!invoice.clientId && !!invoice.finalizedAt && !!invoice.issuerSnapshot && !!invoice.counterpartySnapshot;
}

async function lockNote(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "DeliveryNote" WHERE "id" = ${id} FOR UPDATE`);
  if (!rows.length) throw new Error("Dodací list neexistuje.");
}

export async function issueDeliveryNote(raw: DeliveryNoteInput, actorId: string) {
  const input = issueDeliveryNoteSchema.parse(raw);
  const issueDate = new Date(input.issueDate);
  const deliveryDate = new Date(input.deliveryDate);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1::int FROM pg_advisory_xact_lock(hashtext(${`delivery-note:${input.submissionKey}`}))`;
    const existing = await tx.deliveryNote.findUnique({ where: { submissionKey: input.submissionKey } });
    if (existing) {
      if (existing.createdById !== actorId) throw new Error("Dodací list nepatrí k tejto požiadavke.");
      return existing;
    }

    let order: SourceOrder | null = null;
    if (input.orderId) {
      const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`);
      if (!locked.length) throw new Error("Objednávka neexistuje.");
      const prior = await tx.deliveryNote.findFirst({ where: { orderId: input.orderId, cancelledAt: null } });
      if (prior) return prior;
      await lockUnbilledOrders(tx, [input.orderId], "VYDANA");
      order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: sourceOrderInclude });
      if (order.updatedAt.toISOString() !== input.expectedOrderUpdatedAt) throw new Error("Objednávka sa zmenila. Obnovte formulár.");
      if (order.status === "ZRUSENA" || (!["EXPEDOVANA", "DORUCENA"].includes(order.status) && !["SHIPPED_EXTERNALLY", "DELIVERED_EXTERNALLY"].includes(order.shipmentStatus ?? ""))) {
        throw new Error("Dodací list z objednávky možno vystaviť po potvrdení expedície alebo doručenia.");
      }
    }

    let invoice: Prisma.InvoiceGetPayload<{ include: { items: true; deliveryNoteLinks: true } }> | null = null;
    if (input.invoiceId) {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Invoice" WHERE "id" = ${input.invoiceId} FOR UPDATE`);
      invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: {
        items: { orderBy: { lineNumber: "asc" } }, deliveryNoteLinks: true,
      } });
      if (!invoice || !canCreateDeliveryFromInvoice(invoice)) throw new Error("Vyberte vystavenú faktúru s úplnými údajmi oboch strán.");
      if (invoice.deliveryNoteLinks.length) throw new Error("Faktúra už má naviazaný dodací list.");
    }
    const quote = input.quoteId ? await quoteForConversion(tx, input.quoteId) : null;
    if (quote && issueDate < quote.issueDate) throw new Error("Dodací list nemôže predchádzať cenovej ponuke.");
    const clientId = order?.clientId ?? invoice?.clientId ?? quote?.clientId ?? input.clientId;
    const legalEntity = order ? order.legalEntity : invoice ? invoice.legalEntity : quote ? quote.legalEntity : input.legalEntity;
    if (!clientId || (legalEntity !== "KURGI" && legalEntity !== "SOLE_TRADER")) throw new Error("Vyberte dodávateľa a odberateľa.");
    const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
    if (!client.isActive && !invoice) throw new Error("Odberateľ je archivovaný.");
    const company = invoice || quote ? null : await tx.companyProfile.findFirst({
      where: { legalEntity, isActive: true, validFrom: { lte: deliveryDate }, OR: [{ validTo: null }, { validTo: { gte: deliveryDate } }] },
      orderBy: { validFrom: "desc" },
    });
    if (!company && !invoice && !quote) throw new Error("Pre dátum dodania chýba platný profil dodávateľa.");

    const lines = order ? deliveryLinesSchema.parse([
      ...order.items.map(row => ({
        productId: row.productId, productSku: row.product.sku, description: row.product.name,
        quantity: row.quantity, unit: row.product.unit, unitPriceExact: row.unitPriceExact?.toString() ?? (row.unitPriceCents / 100).toFixed(2),
        vatRate: row.vatRate,
      })),
      ...order.charges.filter(row => row.includedInSellerTotal).map(row => ({
        description: row.description, quantity: 1, unit: "ks", unitPriceExact: (row.unitPriceCents / 100).toFixed(2), vatRate: row.vatRate, kind: "CHARGE",
      })),
    ]) : invoice ? deliveryLinesSchema.parse(invoice.items.map(row => ({
      productId: row.productId ?? undefined, productSku: row.productSku ?? undefined, description: row.description,
      quantity: row.quantity, unit: row.unit, unitPriceExact: row.unitPriceExact?.toString() ?? (row.unitPriceCents / 100).toFixed(2),
      vatRate: row.vatRate,
    }))) : deliveryLinesSchema.parse(quote?.lines ?? input.lines);
    if (!lines.some(line => line.kind === "GOODS")) throw new Error("Dodací list musí obsahovať dodanú položku.");
    const productIds = [...new Set(lines.map(line => line.productId).filter((id): id is string => !!id))];
    if (!order && !invoice && !quote && productIds.length) {
      const products = await tx.product.findMany({ where: { id: { in: productIds }, isActive: true }, select: { id: true, sku: true } });
      for (const line of lines) {
        if (!line.productId) continue;
        const product = products.find(item => item.id === line.productId);
        if (!product) throw new Error(`Položka ${line.description}: produkt už nie je aktívny.`);
        line.productSku = product.sku;
      }
    }
    for (const line of lines) {
      if (!order && !invoice && !quote) line.kind = "GOODS";
      if (line.unitPriceExact) line.unitPriceExact = parseUnitPrice(line.unitPriceExact);
      else delete line.unitPriceExact;
    }
    const number = await nextEntityNumber(tx, "DL", issueDate.getUTCFullYear(), legalEntity);
    const note = await tx.deliveryNote.create({ data: {
      number, submissionKey: input.submissionKey, legalEntity, clientId, orderId: order?.id, quoteId: quote?.id ?? invoice?.quoteId ?? order?.quoteId,
      sourceOrderHash: order ? deliveryOrderHash(order) : undefined,
      supplierOrderNumber: order?.orderNumber, supplierOrderDate: order ? new Date(localDate(order.orderDate)) : undefined,
      buyerOrderNumber: input.buyerOrderNumber, issueDate, deliveryDate, note: input.note,
      deliveryAddress: input.deliveryAddress || [
        order?.deliveryStreet,
        [order?.deliveryZip, order?.deliveryCity].filter(Boolean).join(" "),
        order?.deliveryCountry,
      ].filter(Boolean).join(", ") || undefined,
      issuerSnapshot: (invoice || quote
        ? financePartySnapshotSchema.parse(invoice?.issuerSnapshot ?? quote?.issuerSnapshot)
        : billingParty({ ...company!, name: company!.legalName })) as Prisma.InputJsonObject,
      counterpartySnapshot: (invoice || quote
        ? financePartySnapshotSchema.parse(invoice?.counterpartySnapshot ?? quote?.counterpartySnapshot)
        : billingParty(client)) as Prisma.InputJsonObject,
      lines, createdById: actorId,
    } });
    if (invoice) {
      await tx.invoiceDeliveryNote.create({ data: { invoiceId: invoice.id, deliveryNoteId: note.id, firstLineNumber: 1, lineCount: lines.length } });
    }
    await tx.auditLog.create({ data: {
      action: "DELIVERY_NOTE_ISSUED", entityType: "DeliveryNote", entityId: note.id, actorId,
      afterData: { number, orderId: note.orderId, invoiceId: invoice?.id ?? null, quoteId: quote?.id ?? null, clientId, legalEntity },
    } });
    return note;
  });
}

export async function cancelDeliveryNote(noteId: string, reason: string, actorId: string) {
  if (!reason.trim() || reason.length > 500) throw new Error("Uveďte dôvod zrušenia do 500 znakov.");
  await prisma.$transaction(async tx => {
    await lockNote(tx, noteId);
    const linked = await tx.invoiceDeliveryNote.findFirst({
      where: { deliveryNoteId: noteId, invoice: { OR: [...invoiceKeepsDelivery.OR] } },
    });
    if (linked) throw new Error("Dodací list má koncept alebo vystavenú faktúru.");
    const changed = await tx.deliveryNote.updateMany({ where: { id: noteId, cancelledAt: null }, data: { cancelledAt: new Date() } });
    if (!changed.count) return;
    await tx.auditLog.create({ data: {
      action: "DELIVERY_NOTE_CANCELLED", entityType: "DeliveryNote", entityId: noteId, actorId,
      metadata: { reason: reason.trim() },
    } });
  });
}

export async function validateDeliveryOrders(tx: Tx, notes: DeliveryNote[], lockOrders: boolean) {
  const ids = notes.map(note => note.orderId).filter((id): id is string => !!id).sort();
  if (lockOrders) {
    for (const id of ids) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`);
  }
  const orders = ids.length ? await tx.order.findMany({ where: { id: { in: ids } }, include: sourceOrderInclude }) : [];
  for (const note of notes) {
    if (!note.orderId) continue;
    const order = orders.find(item => item.id === note.orderId);
    if (!order || order.status === "ZRUSENA" || deliveryOrderHash(order) !== note.sourceOrderHash) {
      throw new Error(`Dodací list ${note.number}: objednávka sa zmenila. Skontrolujte dodanie a vystavte aktuálny dodací list.`);
    }
  }
  return orders;
}

export async function buildDeliveryInvoice(tx: Tx, raw: InvoiceDeliverySelection, issueDate: Date) {
  const selection = invoiceDeliveryNotesSchema.parse(raw);
  const ids = [...new Set(selection.ids)].sort();
  if (ids.length !== selection.ids.length) throw new Error("Dodací list je vybraný viackrát.");
  for (const id of ids) await lockNote(tx, id);
  const notes = await tx.deliveryNote.findMany({
    where: { id: { in: ids } }, orderBy: [{ deliveryDate: "asc" }, { number: "asc" }],
    include: { invoiceLinks: { where: { invoice: { OR: [...invoiceKeepsDelivery.OR] } }, include: { invoice: { select: { invoiceNumber: true } } }, take: 1 } },
  });
  const first = notes[0];
  const last = notes.at(-1);
  if (!first || !last || notes.length !== ids.length) throw new Error("Vybrané dodacie listy neexistujú.");
  const legalEntity = first.legalEntity;
  if (legalEntity !== "KURGI" && legalEntity !== "SOLE_TRADER") throw new Error("Dodací list nemá platný subjekt.");
  if (dateKey(first.deliveryDate).slice(0, 7) !== dateKey(last.deliveryDate).slice(0, 7)) {
    throw new Error("Súhrnná faktúra môže zahŕňať dodania z jedného kalendárneho mesiaca.");
  }
  if (last.deliveryDate > issueDate) throw new Error("Dátum vystavenia faktúry je pred posledným dodaním.");
  for (const note of notes) {
    if (note.cancelledAt) throw new Error(`Dodací list ${note.number} je zrušený.`);
    if (note.clientId !== first.clientId || note.legalEntity !== legalEntity) throw new Error("Vyberte dodacie listy rovnakého odberateľa a dodávateľa.");
    if (note.invoiceLinks.length) throw new Error(`Dodací list ${note.number} už má ${note.invoiceLinks[0].invoice.invoiceNumber ?? "koncept faktúry"}.`);
  }
  const linkedOrders = notes.map(note => note.orderId).filter((id): id is string => !!id);
  await lockUnbilledOrders(tx, linkedOrders, "VYDANA", true);
  await validateDeliveryOrders(tx, notes, false);
  const lines = notes.map(note => deliveryLinesSchema.parse(note.lines));
  if (lines.reduce((count, rows) => count + rows.length, 0) > 300) throw new Error("Jedna faktúra môže obsahovať najviac 300 položiek.");
  const prices = new Map(selection.missingPrices.map(row => [`${row.noteId}:${row.index}`, row.price]));
  if (prices.size !== selection.missingPrices.length) throw new Error("Cena položky bola zadaná dvakrát.");
  const productIds = [...new Set(lines.flat().map(line => line.productId).filter((id): id is string => !!id))];
  const [company, rates] = await Promise.all([
    tx.companyProfile.findFirst({
      where: { legalEntity, isActive: true, validFrom: { lte: last.deliveryDate }, OR: [{ validTo: null }, { validTo: { gte: last.deliveryDate } }] },
      orderBy: { validFrom: "desc" },
      include: { taxProfiles: {
        where: { validFrom: { lte: last.deliveryDate }, OR: [{ validTo: null }, { validTo: { gte: last.deliveryDate } }] },
        orderBy: { validFrom: "desc" }, take: 1,
      } },
    }),
    productIds.length ? tx.productVatRate.findMany({
      where: { productId: { in: productIds }, validFrom: { lte: last.deliveryDate }, OR: [{ validTo: null }, { validTo: { gte: first.deliveryDate } }] },
      orderBy: { validFrom: "desc" },
    }) : [],
  ]);
  const tax = company?.taxProfiles[0];
  const items: InvoiceLineInput[] = [];
  const links = notes.map((note, noteIndex) => {
    const firstLineNumber = items.length + 1;
    const payer = isVatPayerAtDate(tax?.vatStatus ?? "", tax?.vatRegisteredFrom, note.deliveryDate);
    for (const [index, row] of lines[noteIndex].entries()) {
      const key = `${note.id}:${index}`;
      const submittedPrice = prices.get(key);
      if (row.unitPriceExact && submittedPrice) throw new Error(`Dodací list ${note.number}, položka ${index + 1}: cena zo zdroja sa nemení.`);
      const rawPrice = row.unitPriceExact ?? submittedPrice;
      if (rawPrice === undefined) throw new Error(`Dodací list ${note.number}: zadajte cenu položky ${row.description}.`);
      const exact = parseUnitPrice(rawPrice);
      prices.delete(key);
      const fmcg = parseFmcgLine({ properties: {
        delivery_note_number: note.number, delivery_note_date: dateKey(note.issueDate), delivery_date: dateKey(note.deliveryDate),
        ...(note.buyerOrderNumber ? { buyer_order_number: note.buyerOrderNumber } : {}),
        ...(note.supplierOrderNumber ? { supplier_order_number: note.supplierOrderNumber } : {}),
        ...(note.supplierOrderDate ? { supplier_order_date: dateKey(note.supplierOrderDate) } : {}),
      } }, items.length + 1);
      const rate = rates.find(rate => rate.productId === row.productId && rate.validFrom <= note.deliveryDate &&
        (!rate.validTo || rate.validTo >= note.deliveryDate));
      items.push({
        description: row.description, productId: row.productId, productSku: row.productSku,
        quantity: row.quantity, unit: row.unit, unitPriceExact: exact, unitPriceCents: unitPriceCents(exact),
        vatRate: tax && !payer ? 0 : (rate?.confirmedAt ? rate.rate : row.vatRate ?? (payer ? 23 : 0)), fmcg,
      });
    }
    return { deliveryNoteId: note.id, firstLineNumber, lineCount: lines[noteIndex].length };
  });
  if (prices.size) throw new Error("Zadaná cena nepatrí k vybraným položkám.");
  return {
    items, links, clientId: first.clientId, legalEntity,
    from: first.deliveryDate, to: last.deliveryDate,
  };
}
