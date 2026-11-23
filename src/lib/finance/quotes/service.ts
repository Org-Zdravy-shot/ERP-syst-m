import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { nextEntityNumber } from "@/lib/invoicing";
import { financePartySnapshotSchema } from "@/lib/zod-schemas";
import { parseUnitPrice, unitPriceCents } from "@/lib/precise-price";
import { calculateInvoice, isVatPayerAtDate } from "../domain";
import { deliveryLinesSchema } from "../delivery/schema";

export const quoteInputSchema = z.object({
  submissionKey: z.uuid(),
  legalEntity: z.enum(["KURGI", "SOLE_TRADER"]),
  clientId: z.string().min(1).max(100),
  issueDate: z.iso.date(),
  validUntil: z.iso.date(),
  lines: deliveryLinesSchema,
  note: z.string().trim().max(1000).optional(),
});

export const quoteDecision = z.enum(["PENDING", "ACCEPTED", "REJECTED"]);
type Tx = Prisma.TransactionClient;

export function billingParty(row: { name: string; ico?: string | null; dic?: string | null; icDph?: string | null; street?: string | null; city?: string | null; zip?: string | null; country: string }) {
  return financePartySnapshotSchema.parse({
    name: row.name, ico: row.ico || undefined, dic: row.dic || undefined, icDph: row.icDph || undefined,
    street: row.street || undefined, city: row.city || undefined, zip: row.zip || undefined, country: row.country,
  });
}

export function priceQuoteLines(lines: unknown) {
  return deliveryLinesSchema.parse(lines).map(row => {
    if (!row.unitPriceExact) throw new Error(`Zadajte cenu položky ${row.description}.`);
    const unitPriceExact = parseUnitPrice(row.unitPriceExact);
    return { ...row, unitPriceExact, unitPriceCents: unitPriceCents(unitPriceExact), vatRate: row.vatRate ?? 0 };
  });
}

export async function issueQuote(raw: z.input<typeof quoteInputSchema>, actorId: string) {
  const input = quoteInputSchema.parse(raw);
  if (input.validUntil < input.issueDate) throw new Error("Platnosť ponuky sa nemôže skončiť pred vystavením.");
  const issueDate = new Date(input.issueDate);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1::int FROM pg_advisory_xact_lock(hashtext(${`sales-quote:${input.submissionKey}`}))`;
    const prior = await tx.salesQuote.findUnique({ where: { submissionKey: input.submissionKey } });
    if (prior) {
      if (prior.createdById !== actorId) throw new Error("Ponuka nepatrí k tejto požiadavke.");
      return prior;
    }
    const lines = priceQuoteLines(input.lines);
    const ids = [...new Set(lines.map(row => row.productId).filter((id): id is string => !!id))];
    const [company, client, products] = await Promise.all([
      tx.companyProfile.findFirst({
        where: { legalEntity: input.legalEntity, isActive: true, validFrom: { lte: issueDate }, OR: [{ validTo: null }, { validTo: { gte: issueDate } }] },
        orderBy: { validFrom: "desc" },
        include: { taxProfiles: {
          where: { validFrom: { lte: issueDate }, OR: [{ validTo: null }, { validTo: { gte: issueDate } }] },
          orderBy: { validFrom: "desc" }, take: 1,
        } },
      }),
      tx.client.findUnique({ where: { id: input.clientId } }),
      tx.product.findMany({
        where: { id: { in: ids }, isActive: true },
        select: { id: true, sku: true, vatRates: {
          where: { validFrom: { lte: issueDate }, OR: [{ validTo: null }, { validTo: { gte: issueDate } }] },
          orderBy: { validFrom: "desc" }, take: 1,
        } },
      }),
    ]);
    if (!company || !client?.isActive) throw new Error("Vyberte platného dodávateľa a aktívneho odberateľa.");
    const tax = company.taxProfiles[0];
    if (!tax) throw new Error("Dodávateľ nemá platný daňový profil.");
    const payer = isVatPayerAtDate(tax.vatStatus, tax.vatRegisteredFrom, issueDate);
    const rows = lines.map((row, index) => {
      const product = products.find(product => product.id === row.productId);
      if (row.productId && !product) throw new Error(`Položka ${row.description}: produkt už nie je aktívny.`);
      const rate = product?.vatRates[0];
      if (payer && product && !rate?.confirmedAt) throw new Error(`Položka ${row.description}: chýba potvrdená sadzba DPH.`);
      const vatRate = payer ? rate?.rate ?? (input.lines[index].vatRate ?? 23) : 0;
      return { ...row, productSku: product?.sku, vatRate };
    });
    const calculation = calculateInvoice({ currency: "EUR", lines: rows });
    const number = await nextEntityNumber(tx, "CP", issueDate.getUTCFullYear(), input.legalEntity);
    const quote = await tx.salesQuote.create({
      data: {
        number, submissionKey: input.submissionKey, legalEntity: input.legalEntity, clientId: client.id, issueDate, validUntil: new Date(input.validUntil),
        issuerSnapshot: billingParty({ ...company, name: company.legalName }) as Prisma.InputJsonObject,
        counterpartySnapshot: billingParty(client) as Prisma.InputJsonObject,
        lines: rows, note: input.note, createdById: actorId,
        totalNetCents: calculation.totalNetCents, totalVatCents: calculation.totalVatCents, totalGrossCents: calculation.totalGrossCents,
      },
    });
    await tx.auditLog.create({ data: { action: "QUOTE_ISSUED", entityType: "SalesQuote", entityId: quote.id, actorId, afterData: { number } } });
    return quote;
  });
}

export async function lockQuote(tx: Tx, id: string) {
  const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "SalesQuote" WHERE "id" = ${id} FOR UPDATE`);
  if (!locked.length) throw new Error("Cenová ponuka neexistuje.");
  return tx.salesQuote.findUniqueOrThrow({ where: { id }, include: {
    order: { select: { id: true, orderNumber: true } },
    deliveryNotes: { where: { cancelledAt: null }, take: 1, select: { id: true, number: true } },
    invoices: { where: { OR: [{ documentStatus: { not: "CANCELLED" } }, { finalizedAt: { not: null } }] }, take: 1, select: { id: true, invoiceNumber: true } },
  } });
}

export function hasQuoteDocument(quote: Awaited<ReturnType<typeof lockQuote>>) {
  return !!(quote.order || quote.deliveryNotes.length || quote.invoices.length);
}

export async function quoteForConversion(tx: Tx, id: string) {
  const quote = await lockQuote(tx, id);
  if (quote.status !== "ACCEPTED") throw new Error("Pred vytvorením dokladu označte ponuku ako schválenú.");
  if (hasQuoteDocument(quote)) throw new Error("Z tejto ponuky už vznikol doklad. Otvorte ho v detaile ponuky.");
  const legalEntity = quote.legalEntity;
  if (legalEntity !== "KURGI" && legalEntity !== "SOLE_TRADER") throw new Error("Ponuka nemá platný právny subjekt.");
  return { ...quote, legalEntity: legalEntity as "KURGI" | "SOLE_TRADER", items: priceQuoteLines(quote.lines) };
}

export async function setQuoteDecision(id: string, requested: z.infer<typeof quoteDecision>, actorId: string) {
  await prisma.$transaction(async tx => {
    const quote = await lockQuote(tx, id);
    const decision = quoteDecision.parse(requested);
    if (quote.status === decision) return;
    if (hasQuoteDocument(quote)) throw new Error("Ponuka už má naviazaný doklad.");
    await tx.salesQuote.update({ where: { id }, data: { status: decision } });
    await tx.auditLog.create({ data: {
      action: "QUOTE_DECISION", entityType: "SalesQuote", entityId: id, actorId,
      beforeData: { status: quote.status }, afterData: { status: decision },
    } });
  });
}

export async function convertQuoteToOrder(id: string, orderDate: Date, actorId: string) {
  if (!Number.isFinite(orderDate.getTime())) throw new Error("Zadajte dátum objednávky.");
  return prisma.$transaction(async tx => {
    const quote = await quoteForConversion(tx, id);
    if (orderDate < quote.issueDate) throw new Error("Objednávka nemôže predchádzať cenovej ponuke.");
    if (quote.items.some(row => !row.productId || !Number.isInteger(row.quantity))) {
      throw new Error("Objednávka vyžaduje skladové produkty s celým množstvom. Z ponuky môžete vytvoriť dodací list alebo faktúru.");
    }
    const ids = [...new Set(quote.items.map(row => row.productId!))];
    if (await tx.product.count({ where: { id: { in: ids }, isActive: true } }) !== ids.length) throw new Error("Niektorý produkt z ponuky už nie je aktívny.");
    if (!await tx.client.count({ where: { id: quote.clientId, isActive: true } })) throw new Error("Odberateľ je archivovaný.");
    const orderNumber = await nextEntityNumber(tx, "OBJ", orderDate.getUTCFullYear(), quote.legalEntity);
    const order = await tx.order.create({ data: {
      quoteId: quote.id, orderNumber, legalEntity: quote.legalEntity, clientId: quote.clientId, orderDate,
      channel: "MANUAL", paymentMethod: "UNAGREED", note: quote.note,
      items: { create: quote.items.map(line => ({
        productId: line.productId!, quantity: line.quantity, unitPriceExact: line.unitPriceExact,
        unitPriceCents: line.unitPriceCents, vatRate: line.vatRate, priceSource: "MANUAL",
      })) },
    } });
    await tx.auditLog.create({ data: {
      action: "QUOTE_CONVERTED_TO_ORDER", entityType: "SalesQuote", entityId: id, actorId,
      metadata: { orderId: order.id, orderNumber },
    } });
    return order;
  });
}
