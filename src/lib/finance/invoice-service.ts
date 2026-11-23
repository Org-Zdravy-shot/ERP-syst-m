import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextNumber, nextEntityNumber } from "@/lib/invoicing";
import { financePartySnapshotSchema } from "@/lib/zod-schemas";
import type {
  AccountingExport,
  AccountingExportInput,
  CalculateInvoiceInput,
  CreateCreditNoteInput,
  CreateInvoiceDraftInput,
  FinalizedInvoice,
  InvoiceCalculation,
  InvoiceDirection,
  InvoiceDocumentStatus,
  InvoiceDocumentType,
  InvoicePaymentStatus,
  InvoiceResult,
  InvoiceLineCalculation,
  UpdateInvoiceDraftInput,
  InvoiceService,
  PartySnapshot,
  TaxSnapshot,
} from "./contracts";
import {
  assertCreditWithinOriginal,
  assertDocumentTransition,
  calculateInvoice,
  calculatePaymentStatus,
  defaultInvoiceVariableSymbol,
  FinanceDomainError,
  isVatPayerAtDate,
} from "./domain";
import { resolveMailProviderKind } from "./mail/config";
import { parseFmcgLine } from "./einvoice/fmcg";
import { isPayBySquareBankAccount } from "./documents/pay-by-square";
import { buildConsolidation, consolidationSchema, lockUnbilledOrders, sourceOrderHash, sourceOrderInclude } from "./consolidation";
import { buildDeliveryInvoice, dateKey, validateDeliveryOrders } from "./delivery/service";
import { quoteForConversion } from "./quotes/service";

type Tx = Prisma.TransactionClient;

type InvoiceWithDetails = Prisma.InvoiceGetPayload<{
  include: {
    client: true;
    items: { include: { product: true } };
    paymentAllocations: true;
  };
}>;

export interface IssuingGateResult {
  ready: boolean;
  blockers: string[];
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parsePartySnapshot(value: Prisma.JsonValue | null): PartySnapshot | null {
  const parsed = financePartySnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function partyFromClient(client: InvoiceWithDetails["client"]): PartySnapshot | null {
  if (!client) return null;
  return {
    name: client.name,
    ...(client.ico ? { ico: client.ico } : {}),
    ...(client.dic ? { dic: client.dic } : {}),
    ...(client.icDph ? { icDph: client.icDph } : {}),
    ...(client.email ? { email: client.email } : {}),
    ...(client.phone ? { phone: client.phone } : {}),
    ...(client.iban ? { iban: client.iban } : {}),
    ...(client.street ? { street: client.street } : {}),
    ...(client.city ? { city: client.city } : {}),
    ...(client.zip ? { zip: client.zip } : {}),
    country: client.country,
  };
}

function asDirection(value: string): InvoiceDirection {
  if (value === "VYDANA" || value === "PRIJATA") return value;
  throw new FinanceDomainError("INVALID_LINE", "Faktúra má neplatný smer.");
}

function asDocumentType(value: string): InvoiceDocumentType {
  if (value === "INVOICE" || value === "CREDIT_NOTE") return value;
  throw new FinanceDomainError("INVALID_LINE", "Faktúra má neplatný typ dokladu.");
}

function asDocumentStatus(value: string): InvoiceDocumentStatus {
  if (value === "DRAFT" || value === "ISSUED" || value === "CANCELLED") return value;
  throw new FinanceDomainError("INVALID_LINE", "Faktúra má neplatný stav dokladu.");
}

function validateDraftDates(input: CreateInvoiceDraftInput): void {
  if (
    Number.isNaN(input.issueDate.getTime()) ||
    Number.isNaN(input.dueDate.getTime()) ||
    (input.deliveryDate && Number.isNaN(input.deliveryDate.getTime()))
  ) {
    throw new FinanceDomainError("INVALID_LINE", "Faktúra obsahuje neplatný dátum.");
  }
  if (input.dueDate.getTime() < input.issueDate.getTime()) {
    throw new FinanceDomainError("INVALID_LINE", "Dátum splatnosti nesmie byť pred dátumom vystavenia.");
  }
}

function normalizeBuyerReference(value?: string): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > 140 || /[\u0000-\u001F\uFFFE\uFFFF]/u.test(trimmed)) {
    throw new FinanceDomainError("INVALID_LINE", "Referencia odberateľa môže mať najviac 140 znakov a nesmie obsahovať riadiace znaky.");
  }
  return trimmed;
}

function invoiceLineData(line: InvoiceLineCalculation) {
  return {
    productId: line.productId ?? null, lineNumber: line.lineNumber,
    description: line.description, productSku: line.productSku ?? null,
    quantity: line.quantity, unit: line.unit,
    unitPriceCents: line.unitPriceCents, unitPriceExact: line.unitPriceExact ?? null,
    vatRate: line.vatRate, totalNetCents: line.totalNetCents,
    totalVatCents: line.totalVatCents, totalGrossCents: line.totalGrossCents,
    taxCategory: line.taxCategory ?? "STANDARD",
    ...(line.fmcg ? { fmcgSnapshot: toJson(line.fmcg) } : {}),
  };
}

function mapInvoiceResult(
  invoice: {
    id: string;
    invoiceNumber: string | null;
    direction: string;
    documentType: string;
    documentStatus: string;
  },
  calculation: InvoiceCalculation,
  paymentStatus: InvoicePaymentStatus,
): InvoiceResult {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    direction: asDirection(invoice.direction),
    documentType: asDocumentType(invoice.documentType),
    documentStatus: asDocumentStatus(invoice.documentStatus),
    paymentStatus,
    calculation,
  };
}

async function lockInvoice(tx: Tx, invoiceId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`,
  );
  if (rows.length === 0) {
    throw new FinanceDomainError("INVOICE_NOT_FOUND", "Faktúra neexistuje.");
  }
}

function productionInfrastructureBlockers(env: NodeJS.ProcessEnv): string[] {
  if (env.NODE_ENV !== "production") return [];
  const blockers: string[] = [];
  if (env.FINANCE_PRODUCTION_ISSUING_ENABLED !== "true") {
    blockers.push("Produkčné vystavenie faktúr nie je explicitne povolené.");
  }
  if (!(env.DOCUMENT_BUCKET_NAME || env.BUCKET)) {
    blockers.push("Nie je nastavený privátny bucket pre finančné dokumenty.");
  }
  if (!(env.DOCUMENT_BUCKET_ENDPOINT || env.ENDPOINT)) {
    blockers.push("Nie je nastavený endpoint privátneho bucketu.");
  }
  if (!(env.DOCUMENT_BUCKET_ACCESS_KEY_ID || env.ACCESS_KEY_ID)) {
    blockers.push("Nie je nastavený prístupový kľúč privátneho bucketu.");
  }
  if (!(env.DOCUMENT_BUCKET_SECRET_ACCESS_KEY || env.SECRET_ACCESS_KEY)) {
    blockers.push("Nie je nastavený tajný kľúč privátneho bucketu.");
  }
  try {
    if (resolveMailProviderKind(env) === "RESEND") {
      if (!env.RESEND_API_KEY?.trim()) {
        blockers.push("Nie je nastavený API kľúč transakčného Resend providera.");
      }
    } else {
      const smtpPort = Number(env.SMTP_PORT);
      if (!env.SMTP_HOST || !Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65_535) {
        blockers.push("Nie je platne nastavený transakčný SMTP provider.");
      }
      if (!!env.SMTP_USER !== !!env.SMTP_PASS) {
        blockers.push("SMTP používateľ a heslo musia byť nastavené spoločne.");
      }
    }
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : "E-mailový provider nie je platne nastavený.");
  }
  if (env.MAIL_FROM?.trim().toLowerCase() !== "info@zdravyshot.sk") {
    blockers.push("Odosielateľ faktúr musí byť info@zdravyshot.sk.");
  }
  if (env.FINANCE_MAIL_DKIM_CONFIRMED !== "true") {
    blockers.push("DKIM transakčného e-mailového providera nie je potvrdený.");
  }
  return blockers;
}

export function evaluateProductionIssuingInfrastructure(
  env: NodeJS.ProcessEnv = process.env,
): IssuingGateResult {
  const blockers = productionInfrastructureBlockers(env);
  return { ready: blockers.length === 0, blockers };
}

async function createAudit(
  tx: Tx,
  input: {
    actorId: string;
    action: string;
    entityId: string;
    beforeData?: unknown;
    afterData?: unknown;
    metadata?: unknown;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: "Invoice",
      entityId: input.entityId,
      ...(input.beforeData === undefined ? {} : { beforeData: toJson(input.beforeData) }),
      ...(input.afterData === undefined ? {} : { afterData: toJson(input.afterData) }),
      ...(input.metadata === undefined ? {} : { metadata: toJson(input.metadata) }),
    },
  });
}

export class PrismaInvoiceService implements InvoiceService {
  calculate(input: CalculateInvoiceInput): InvoiceCalculation {
    return calculateInvoice(input);
  }

  async createDraft(input: CreateInvoiceDraftInput): Promise<InvoiceResult> {
    const prepared = this.prepareDraft(input);
    return prisma.$transaction(tx => this.persistDraft(tx, input, prepared));
  }

  async createDraftInTransaction(tx: Tx, input: CreateInvoiceDraftInput): Promise<InvoiceResult> {
    return this.persistDraft(tx, input, this.prepareDraft(input));
  }

  private prepareDraft(input: CreateInvoiceDraftInput) {
    if (!input.actorId.trim()) throw new FinanceDomainError("INVALID_LINE", "Chýba používateľ operácie.");
    validateDraftDates(input);
    const buyerReference = normalizeBuyerReference(input.buyerReference);
    if (input.documentType === "CREDIT_NOTE" && !input.originalInvoiceId) {
      throw new FinanceDomainError("INVALID_LINE", "Dobropis musí odkazovať na pôvodnú faktúru.");
    }
    const counterparty = input.counterparty
      ? financePartySnapshotSchema.parse(input.counterparty)
      : undefined;
    const manualCalculation = input.consolidation || input.deliveryNotes || input.quoteId ? undefined : calculateInvoice({ currency: input.currency, lines: input.items });
    return { buyerReference, counterparty, manualCalculation };
  }

  private async persistDraft(tx: Tx, input: CreateInvoiceDraftInput, prepared: ReturnType<PrismaInvoiceService["prepareDraft"]>): Promise<InvoiceResult> {
    const { buyerReference, counterparty, manualCalculation } = prepared;
    let summary: ReturnType<typeof buildConsolidation> | undefined;
    let delivery: Awaited<ReturnType<typeof buildDeliveryInvoice>> | undefined;
    let quote: Awaited<ReturnType<typeof quoteForConversion>> | undefined;
    if (input.quoteId) {
      if (input.deliveryNotes || input.consolidation || input.orderId || input.direction !== "VYDANA" || (input.documentType ?? "INVOICE") !== "INVOICE" || (input.source ?? "INTERNA") !== "INTERNA" || counterparty || !input.deliveryDate) {
        throw new Error("Z ponuky možno vytvoriť vydanú faktúru s dátumom dodania.");
      }
      quote = await quoteForConversion(tx, input.quoteId);
      if (input.issueDate < quote.issueDate || input.deliveryDate > input.issueDate) throw new Error("Skontrolujte dátum dodania a vystavenia faktúry.");
    } else if (input.deliveryNotes) {
      if (input.consolidation || input.orderId || input.direction !== "VYDANA" || (input.documentType ?? "INVOICE") !== "INVOICE" || (input.source ?? "INTERNA") !== "INTERNA" || counterparty) {
        throw new Error("Z dodacích listov možno vytvoriť vydanú faktúru v ERP.");
      }
      delivery = await buildDeliveryInvoice(tx, input.deliveryNotes, input.issueDate);
    } else if (input.consolidation) {
      if (input.orderId || input.direction !== "VYDANA" || (input.documentType ?? "INVOICE") !== "INVOICE" || (input.source ?? "INTERNA") !== "INTERNA" || counterparty) {
        throw new Error("Súhrnná faktúra musí byť interná vydaná faktúra zo zoznamu objednávok.");
      }
      const selections = consolidationSchema.parse(input.consolidation);
      const ids = selections.map(s => s.orderId);
      await lockUnbilledOrders(tx, ids, "VYDANA");
      const orders = await tx.order.findMany({ where: { id: { in: ids } }, include: sourceOrderInclude });
      summary = buildConsolidation(orders, selections, input.issueDate);
    } else if (input.orderId && (input.documentType ?? "INVOICE") === "INVOICE") {
      await lockUnbilledOrders(tx, [input.orderId], input.direction);
    }
    const calculation = manualCalculation ?? calculateInvoice({ currency: input.currency, lines: quote?.items ?? delivery?.items ?? summary!.items });
    const created = await tx.invoice.create({
      data: {
        direction: input.direction,
        legalEntity: quote?.legalEntity ?? delivery?.legalEntity ?? summary?.legalEntity ?? input.legalEntity ?? null,
        documentType: input.documentType ?? "INVOICE",
        documentStatus: "DRAFT",
        source: input.source ?? "INTERNA",
        externalId: input.externalId ?? null,
        externalNumber: input.externalNumber ?? null,
        invoiceNumber: null,
        currency: input.currency,
        clientId: quote?.clientId ?? delivery?.clientId ?? summary?.clientId ?? input.clientId ?? null,
        quoteId: quote?.id ?? null,
        supplierName: input.direction === "PRIJATA" ? counterparty?.name ?? null : null,
        orderId: input.orderId ?? null,
        originalInvoiceId: input.originalInvoiceId ?? null,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        deliveryDate: delivery?.to ?? summary?.to ?? input.deliveryDate ?? null,
        ...(summary ? { consolidatedFrom: summary.from, consolidatedTo: summary.to, orderLinks: { create: summary.links } } : {}),
        ...(delivery ? {
          deliveryNoteLinks: { create: delivery.links },
          ...(delivery.links.length > 1 ? { consolidatedFrom: delivery.from, consolidatedTo: delivery.to } : {}),
        } : {}),
        createdById: input.actorId,
        status: "VYSTAVENA",
        totalNetCents: calculation.totalNetCents,
        totalVatCents: calculation.totalVatCents,
        totalGrossCents: calculation.totalGrossCents,
        variableSymbol: input.variableSymbol ?? null,
        buyerReference: buyerReference ?? null,
        ...(counterparty ? { counterpartySnapshot: toJson(counterparty) } : {}),
        note: input.note ?? quote?.note ?? null,
        items: {
          create: calculation.lines.map(invoiceLineData),
        },
      },
    });
    await createAudit(tx, {
      actorId: input.actorId,
      action: "INVOICE_DRAFT_CREATED",
      entityId: created.id,
      afterData: {
        direction: created.direction,
        documentType: created.documentType,
        documentStatus: created.documentStatus,
        totalGrossCents: created.totalGrossCents,
      },
    });
    return mapInvoiceResult(created, calculation, "UNPAID");
  }

  async updateDraft(invoiceId: string, input: UpdateInvoiceDraftInput): Promise<InvoiceResult> {
    if (!input.actorId.trim()) throw new FinanceDomainError("INVALID_LINE", "Chýba používateľ operácie.");
    validateDraftDates({ ...input, direction: "VYDANA" });
    if (!(input.expectedUpdatedAt instanceof Date) || Number.isNaN(input.expectedUpdatedAt.getTime())) {
      throw new FinanceDomainError("INVALID_LINE", "Chýba verzia upravovaného konceptu. Obnovte formulár.");
    }
    const buyerReference = normalizeBuyerReference(input.buyerReference);
    const calculation = calculateInvoice({ currency: input.currency, lines: input.items });
    return prisma.$transaction(async (tx) => {
      await lockInvoice(tx, invoiceId);
      const current = await tx.invoice.findUnique({ where: { id: invoiceId }, include: {
        items: { orderBy: { lineNumber: "asc" } },
        _count: { select: { paymentAllocations: true, documents: true, eInvoiceTransmissions: true, deliveryNoteLinks: true } },
      } });
      if (!current) throw new FinanceDomainError("INVOICE_NOT_FOUND", "Koncept faktúry neexistuje.");
      if (current.documentStatus !== "DRAFT" || current.invoiceNumber || current.finalizedAt) {
        throw new FinanceDomainError("INVOICE_IMMUTABLE", "Upravovať možno iba nevystavený koncept. Vystavená faktúra zostáva nezmenená.");
      }
      if (current.source !== "INTERNA" || current.direction !== "VYDANA" || current.documentType !== "INVOICE" || current.orderId || current.quoteId || current.consolidatedFrom || current._count.deliveryNoteLinks) {
        throw new FinanceDomainError("INVALID_TRANSITION", "Tento editor upravuje iba ručne vytvorené koncepty bez väzby na objednávky alebo dodacie listy.");
      }
      if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
        throw new FinanceDomainError("INVALID_TRANSITION", "Koncept medzitým zmenil iný používateľ. Obnovte stránku a skontrolujte aktuálnu verziu.");
      }
      if (Object.values(current._count).some((count) => count > 0)) {
        throw new FinanceDomainError("INVALID_TRANSITION", "Koncept už má naviazanú úhradu, dokument alebo elektronický prenos. Úprava je zablokovaná.");
      }
      const data = {
        updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
        legalEntity: input.legalEntity ?? null, clientId: input.clientId ?? null,
        issueDate: input.issueDate, dueDate: input.dueDate, deliveryDate: input.deliveryDate ?? null,
        currency: input.currency, variableSymbol: input.variableSymbol ?? null,
        buyerReference: buyerReference ?? null, externalNumber: input.externalNumber ?? null, note: input.note ?? null,
        totalNetCents: calculation.totalNetCents, totalVatCents: calculation.totalVatCents, totalGrossCents: calculation.totalGrossCents,
        // An edited draft must take fresh party/tax snapshots at finalization.
        issuerSnapshot: Prisma.DbNull, counterpartySnapshot: Prisma.DbNull, taxSnapshot: Prisma.DbNull,
      };
      const updated = await tx.invoice.update({ where: { id: invoiceId }, data: {
        ...data, items: { deleteMany: {}, create: calculation.lines.map(invoiceLineData) },
      } });
      await createAudit(tx, { actorId: input.actorId, action: "INVOICE_DRAFT_UPDATED", entityId: invoiceId,
        beforeData: { updatedAt: current.updatedAt, clientId: current.clientId, legalEntity: current.legalEntity, issueDate: current.issueDate, dueDate: current.dueDate, deliveryDate: current.deliveryDate, buyerReference: current.buyerReference, note: current.note, totalGrossCents: current.totalGrossCents, items: current.items },
        afterData: { ...input, totalGrossCents: calculation.totalGrossCents },
      });
      return mapInvoiceResult(updated, calculation, "UNPAID");
    });
  }

  async finalize(invoiceId: string, actorId: string): Promise<FinalizedInvoice> {
    if (!actorId.trim()) throw new FinanceDomainError("INVALID_LINE", "Chýba používateľ operácie.");

    return prisma.$transaction(async (tx) => {
      await lockInvoice(tx, invoiceId);
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          client: true,
          items: { include: { product: true }, orderBy: { lineNumber: "asc" } },
          paymentAllocations: { where: { reversedAt: null } },
          orderLinks: { include: { order: { include: sourceOrderInclude } }, orderBy: { firstLineNumber: "asc" } },
          deliveryNoteLinks: { include: { deliveryNote: true }, orderBy: { firstLineNumber: "asc" } },
        },
      });
      if (!invoice) throw new FinanceDomainError("INVOICE_NOT_FOUND", "Faktúra neexistuje.");
      if (invoice.source === "HISTORICAL") throw new FinanceDomainError("INVALID_TRANSITION", "Historický originál sa v ERP nevystavuje ani nefinalizuje.");
      if (invoice.documentStatus !== "DRAFT" || invoice.invoiceNumber) {
        throw new FinanceDomainError("INVOICE_IMMUTABLE", "Finalizovať možno iba koncept bez prideleného čísla.");
      }
      if (invoice.items.length === 0) {
        throw new FinanceDomainError("INVALID_LINE", "Faktúra nemá žiadne položky.");
      }
      if (invoice.legalEntity !== "SOLE_TRADER" && invoice.legalEntity !== "KURGI") throw new FinanceDomainError("ISSUING_GATE_BLOCKED", "Pred finalizáciou treba dokladu priradiť overený právny subjekt.");

      const taxDate = invoice.deliveryDate ?? invoice.issueDate;
      const company = await tx.companyProfile.findFirst({
        where: {
          legalEntity: invoice.legalEntity,
          isActive: true,
          validFrom: { lte: taxDate },
          OR: [{ validTo: null }, { validTo: { gte: taxDate } }],
        },
        include: {
          taxProfiles: {
            where: {
              validFrom: { lte: taxDate },
              OR: [{ validTo: null }, { validTo: { gte: taxDate } }],
            },
            orderBy: { validFrom: "desc" },
            take: 1,
          },
          bankAccounts: {
            where: { isActive: true, isPrimary: true, currency: "EUR" },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
        orderBy: { validFrom: "desc" },
      });

      const blockers: string[] = [];
      if (invoice.consolidatedFrom) {
        if (company && company.validFrom > invoice.consolidatedFrom) blockers.push("Firemný profil nepokrýva celé obdobie súhrnnej faktúry.");
        if (company?.taxProfiles[0] && (company.taxProfiles[0].validFrom > invoice.consolidatedFrom || (company.taxProfiles[0].vatRegisteredFrom && company.taxProfiles[0].vatRegisteredFrom > invoice.consolidatedFrom))) blockers.push("Daňový profil sa počas obdobia zmenil. Dodania treba rozdeliť do samostatných faktúr.");
      }
      if (invoice.consolidatedFrom && !invoice.deliveryNoteLinks.length) {
        for (const link of [...invoice.orderLinks].sort((a, b) => a.orderId.localeCompare(b.orderId))) {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${link.orderId} FOR UPDATE`);
          link.order = await tx.order.findUniqueOrThrow({ where: { id: link.orderId }, include: sourceOrderInclude });
        }
        if (!invoice.consolidatedTo || invoice.orderLinks.length < 2) blockers.push("Súhrnná faktúra nemá úplné väzby na objednávky.");
        let nextLine = 1;
        for (const link of invoice.orderLinks) {
          if (sourceOrderHash(link.order) !== link.sourceHash) blockers.push(`Objednávka ${link.order.orderNumber} sa zmenila. Zrušte koncept a vytvorte nový.`);
          const lines = invoice.items.filter(i => i.lineNumber >= link.firstLineNumber && i.lineNumber < link.firstLineNumber + link.lineCount);
          if (link.firstLineNumber !== nextLine || lines.length !== link.lineCount) blockers.push("Riadkové väzby súhrnnej faktúry sú neúplné.");
          nextLine += link.lineCount;
          for (const line of lines) {
            const properties = parseFmcgLine(line.fmcgSnapshot, line.lineNumber).properties;
            if (properties.delivery_date !== link.deliveryDate.toISOString().slice(0, 10) || properties.buyer_order_number !== link.buyerOrderNumber || properties.supplier_order_number !== link.order.orderNumber) blockers.push(`Riadok ${line.lineNumber}: referencia dodania nesúhlasí s objednávkou.`);
          }
        }
        if (nextLine !== invoice.items.length + 1) blockers.push("Nie všetky položky majú väzbu na objednávku.");
      }
      if (!company) blockers.push("Pre dátum dodania neexistuje platný firemný profil.");
      const taxProfile = company?.taxProfiles[0];
      let primaryAccount = company?.bankAccounts[0];
      const vatApplies = invoice.direction === "VYDANA" && isVatPayerAtDate(taxProfile?.vatStatus ?? "", taxProfile?.vatRegisteredFrom, taxDate);
      if (invoice.deliveryNoteLinks.length) {
        const notes = invoice.deliveryNoteLinks.map(link => link.deliveryNote);
        const orders = await validateDeliveryOrders(tx, notes, true);
        let nextLine = 1;
        for (const link of invoice.deliveryNoteLinks) {
          const note = link.deliveryNote;
          if (note.cancelledAt || note.clientId !== invoice.clientId || note.legalEntity !== invoice.legalEntity) blockers.push(`Dodací list ${note.number} už nepatrí k tomuto dokladu.`);
          if (link.firstLineNumber !== nextLine) blockers.push("Riadkové väzby dodacích listov nie sú úplné.");
          const lines = invoice.items.slice(nextLine - 1, nextLine - 1 + link.lineCount);
          nextLine += link.lineCount;
          for (const line of lines) {
            const properties = parseFmcgLine(line.fmcgSnapshot, line.lineNumber).properties;
            if (properties.delivery_note_number !== note.number || properties.delivery_date !== dateKey(note.deliveryDate)) blockers.push(`Riadok ${line.lineNumber}: dodací list nesúhlasí s konceptom.`);
          }
        }
        if (nextLine !== invoice.items.length + 1) blockers.push("Nie všetky položky majú väzbu na dodacie listy.");
        for (const order of orders) {
          const charges = order.charges.filter(charge => charge.includedInSellerTotal);
          if (charges.some(charge => charge.taxTreatment === "UNVERIFIED" || charge.taxTreatment === "FOREIGN" || (vatApplies && charge.taxTreatment === "NON_PAYER"))) {
            blockers.push(`Objednávka ${order.orderNumber}: daňový režim dopravy alebo služby nie je overený.`);
          }
        }
      }
      for (const link of invoice.orderLinks) {
        const charges = link.order.charges.filter(c => c.includedInSellerTotal);
        if (charges.some(c => c.taxTreatment === "UNVERIFIED" || c.taxTreatment === "FOREIGN" || (vatApplies && c.taxTreatment === "NON_PAYER"))) blockers.push(`Objednávka ${link.order.orderNumber}: daňový režim dopravy alebo služby nie je overený pre subjekt.`);
      }
      if (!taxProfile) blockers.push("Pre dátum dodania neexistuje platný daňový profil.");
      if (invoice.direction === "VYDANA") {
        if (!invoice.deliveryDate) blockers.push("Vydaná faktúra musí mať dátum dodania.");
        if (!taxProfile?.accountantConfirmedAt) {
          blockers.push("Daňový profil ešte nepotvrdil účtovník.");
        }
        if (taxProfile?.vatStatus === "PAYER" && !taxProfile.vatRegisteredFrom) {
          blockers.push("Platiteľ DPH nemá potvrdený dátum registrácie.");
        }
        if (!primaryAccount) blockers.push("Chýba primárny EUR bankový účet spoločnosti.");
        else if (!await isPayBySquareBankAccount(primaryAccount.iban, primaryAccount.bic)) {
          blockers.push("Primárny EUR účet vystavovateľa má neplatný IBAN alebo BIC.");
        }
        if (invoice.orderId) {
          const linkedOrder = await tx.order.findUnique({ where: { id: invoice.orderId }, include: { items: true, charges: true } });
          if (!linkedOrder) blockers.push("Prepojená objednávka neexistuje.");
          const charges = linkedOrder?.charges.filter((charge) => charge.includedInSellerTotal) ?? [];
          if (charges.some((charge) => charge.taxTreatment === "UNVERIFIED" || charge.taxTreatment === "FOREIGN")) blockers.push("Daňový režim dopravy alebo služby nie je overený.");
          if (vatApplies && charges.some((charge) => charge.taxTreatment === "NON_PAYER")) blockers.push("Doprava alebo služba je označená ako neplatiteľská, ale daňový profil subjektu je platiteľ.");
          if (linkedOrder) {
            const expected = [
              ...linkedOrder.items.map((item) => `P|${item.productId}|${item.quantity}|${item.unitPriceExact?.toString() ?? item.unitPriceCents}|${item.vatRate}`),
              ...charges.map((charge) => `C|${charge.description}|1|${charge.unitPriceCents}|${charge.vatRate}`),
            ].sort();
            const actual = invoice.items.map((item) => item.productId
              ? `P|${item.productId}|${item.quantity}|${item.unitPriceExact?.toString() ?? item.unitPriceCents}|${item.vatRate}`
              : `C|${item.description}|${item.quantity}|${item.unitPriceCents}|${item.vatRate}`,
            ).sort();
            if (JSON.stringify(expected) !== JSON.stringify(actual)) blockers.push("Koncept sa nezhoduje s aktuálnou objednávkou. Zrušte ho a vytvorte nový, aby sa preniesli presné ceny a doprava.");
          }
        }
        if (process.env.NODE_ENV === "production" && invoice.issueDate.getFullYear() === 2026 && !invoice.legalEntity) {
          const counter = await tx.docCounter.findUnique({ where: { id: "VYDANA-2026" } });
          if (!counter || counter.lastNumber < 8) {
            blockers.push("Číselný rad 2026 nie je pripravený; prvé nové číslo musí byť 2026009.");
          }
        }
        blockers.push(...productionInfrastructureBlockers(process.env));
      }

      const externalParty =
        (invoice.documentType === "CREDIT_NOTE"
          ? parsePartySnapshot(invoice.counterpartySnapshot)
          : partyFromClient(invoice.client)) ??
        partyFromClient(invoice.client) ??
        parsePartySnapshot(invoice.counterpartySnapshot);
      if (!externalParty) blockers.push("Chýba úplný snapshot obchodného partnera.");

      const effectiveLines = [];
      for (const item of invoice.items) {
        const lineTaxDate = invoice.consolidatedFrom
          ? new Date(parseFmcgLine(item.fmcgSnapshot, item.lineNumber).properties.delivery_date!)
          : taxDate;
        let vatRate = item.vatRate;
        let taxCategory = item.taxCategory === "EXEMPT" ? "EXEMPT" as const : "STANDARD" as const;
        if (invoice.direction === "VYDANA" && invoice.documentType !== "CREDIT_NOTE" && !vatApplies) {
          vatRate = 0;
          taxCategory = "EXEMPT";
        } else if (
          vatApplies &&
          invoice.documentType !== "CREDIT_NOTE" &&
          item.productId &&
          taxCategory !== "EXEMPT"
        ) {
          const configuredRate = await tx.productVatRate.findFirst({
            where: {
              productId: item.productId,
              validFrom: { lte: lineTaxDate },
              OR: [{ validTo: null }, { validTo: { gte: lineTaxDate } }],
            },
            orderBy: { validFrom: "desc" },
          });
          if (!configuredRate?.confirmedAt) {
            blockers.push(`Produkt ${item.product?.name ?? item.description} nemá potvrdenú sadzbu DPH.`);
          } else {
            vatRate = configuredRate.rate;
          }
        }
        effectiveLines.push({
          productId: item.productId ?? undefined,
          productSku: item.productSku ?? item.product?.sku ?? undefined,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPriceCents: item.unitPriceCents,
          unitPriceExact: item.unitPriceExact?.toString(),
          vatRate,
          taxCategory,
          ...(item.fmcgSnapshot ? { fmcg: parseFmcgLine(item.fmcgSnapshot, item.lineNumber) } : {}),
        });
      }

      if (blockers.length > 0 || !company || !taxProfile || !externalParty) {
        throw new FinanceDomainError(
          "ISSUING_GATE_BLOCKED",
          `Faktúru nemožno finalizovať: ${[...new Set(blockers)].join(" ")}`,
        );
      }

      const calculation = calculateInvoice({ currency: "EUR", lines: effectiveLines });
      const companyParty: PartySnapshot = {
        name: company.legalName,
        ico: company.ico,
        dic: company.dic,
        ...(company.icDph ? { icDph: company.icDph } : {}),
        email: company.email,
        ...(company.phone ? { phone: company.phone } : {}),
        street: company.street,
        city: company.city,
        zip: company.zip,
        country: company.country,
        ...(primaryAccount ? { iban: primaryAccount.iban } : {}),
        ...(primaryAccount?.bic ? { bic: primaryAccount.bic } : {}),
      };
      const issuerSnapshot = invoice.direction === "VYDANA" ? companyParty : externalParty;
      const counterpartySnapshot = invoice.direction === "VYDANA" ? externalParty : companyParty;
      const taxSnapshot: TaxSnapshot = {
        vatStatus: invoice.direction === "VYDANA" ? (vatApplies ? "PAYER" : "NON_PAYER") : (taxProfile.vatStatus === "PAYER" ? "PAYER" : "NON_PAYER"),
        ...(taxProfile.vatRegisteredFrom ? { vatRegisteredFrom: taxProfile.vatRegisteredFrom } : {}),
        domesticTaxMode: taxProfile.domesticTaxMode === "EXEMPT" ? "EXEMPT" : "STANDARD",
        deliveryDate: taxDate,
      };

      for (const line of calculation.lines) {
        const item = invoice.items[line.lineNumber - 1];
        if (!item) throw new FinanceDomainError("INVALID_LINE", "Počas finalizácie sa zmenili položky faktúry.");
        await tx.invoiceItem.update({
          where: { id: item.id },
          data: {
            lineNumber: line.lineNumber,
            productSku: line.productSku ?? null,
            vatRate: line.vatRate,
            taxCategory: line.taxCategory,
            totalNetCents: line.totalNetCents,
            totalVatCents: line.totalVatCents,
            totalGrossCents: line.totalGrossCents,
          },
        });
      }

      const invoiceNumber = invoice.direction === "VYDANA"
        ? await nextEntityNumber(tx, "VYDANA", invoice.issueDate.getFullYear(), invoice.legalEntity)
        : await nextNumber(tx, "PRIJATA", invoice.issueDate.getFullYear());
      const finalizedAt = new Date();
      assertDocumentTransition("DRAFT", "ISSUED");
      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          invoiceNumber,
          documentStatus: "ISSUED",
          finalizedAt,
          finalizedById: actorId,
          variableSymbol: invoice.variableSymbol || defaultInvoiceVariableSymbol(invoiceNumber),
          issuerSnapshot: toJson(issuerSnapshot),
          counterpartySnapshot: toJson(counterpartySnapshot),
          taxSnapshot: toJson({
            ...taxSnapshot,
            vatRegisteredFrom: taxSnapshot.vatRegisteredFrom?.toISOString(),
            deliveryDate: taxSnapshot.deliveryDate.toISOString(),
          }),
          totalNetCents: calculation.totalNetCents,
          totalVatCents: calculation.totalVatCents,
          totalGrossCents: calculation.totalGrossCents,
        },
      });

      const outbox = await tx.outboxEvent.create({
        data: {
          type: "INVOICE_PDF",
          aggregateType: "Invoice",
          aggregateId: invoice.id,
          idempotencyKey: `invoice:${invoice.id}:finalized:${finalizedAt.toISOString()}:pdf`,
          payload: toJson({
            invoiceId: invoice.id,
            invoiceNumber,
            documentType: invoice.documentType,
          }),
        },
      });
      await createAudit(tx, {
        actorId,
        action: "INVOICE_FINALIZED",
        entityId: invoice.id,
        beforeData: { documentStatus: invoice.documentStatus, invoiceNumber: null },
        afterData: {
          documentStatus: updated.documentStatus,
          invoiceNumber,
          totalGrossCents: updated.totalGrossCents,
        },
      });

      return {
        ...mapInvoiceResult(updated, calculation, "UNPAID"),
        invoiceNumber,
        documentStatus: "ISSUED",
        finalizedAt,
        issuerSnapshot,
        counterpartySnapshot,
        taxSnapshot,
        outboxEventIds: [outbox.id],
      };
    });
  }

  async createCreditNote(input: CreateCreditNoteInput): Promise<InvoiceResult> {
    const original = await prisma.invoice.findUnique({
      where: { id: input.originalInvoiceId },
      include: {
        items: { orderBy: { lineNumber: "asc" } },
        client: true,
        creditNotes: {
          where: { documentStatus: { not: "CANCELLED" } },
          select: { totalGrossCents: true },
        },
      },
    });
    if (!original) throw new FinanceDomainError("INVOICE_NOT_FOUND", "Pôvodná faktúra neexistuje.");
    if (original.documentStatus !== "ISSUED") {
      throw new FinanceDomainError("INVALID_TRANSITION", "Dobropis možno vytvoriť iba k vystavenej faktúre.");
    }
    if (original.documentType !== "INVOICE") {
      throw new FinanceDomainError("INVALID_TRANSITION", "Dobropis nemožno vytvoriť k inému dobropisu.");
    }

    const snapshot =
      partyFromClient(original.client) ??
      parsePartySnapshot(original.direction === "PRIJATA" ? original.issuerSnapshot : original.counterpartySnapshot);
    if (!snapshot) {
      throw new FinanceDomainError("COUNTERPARTY_MISSING", "Pôvodná faktúra nemá snapshot partnera.");
    }
    const items = input.items ?? original.items.map((item) => ({
      productId: item.productId ?? undefined,
      productSku: item.productSku ?? undefined,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
      unitPriceExact: item.unitPriceExact?.toString(),
      vatRate: item.vatRate,
      taxCategory: item.taxCategory === "EXEMPT" ? "EXEMPT" as const : "STANDARD" as const,
      ...(item.fmcgSnapshot ? { fmcg: parseFmcgLine(item.fmcgSnapshot, item.lineNumber) } : {}),
    }));
    const calculation = calculateInvoice({ currency: "EUR", lines: items });
    const alreadyCredited = original.creditNotes.reduce(
      (sum, creditNote) => sum + creditNote.totalGrossCents,
      0,
    );
    assertCreditWithinOriginal(original.totalGrossCents, alreadyCredited, calculation.totalGrossCents);

    return this.createDraft({
      direction: asDirection(original.direction),
      legalEntity: original.legalEntity as "SOLE_TRADER" | "KURGI" | undefined,
      documentType: "CREDIT_NOTE",
      source: "INTERNA",
      clientId: original.clientId ?? undefined,
      counterparty: snapshot,
      buyerReference: original.buyerReference ?? undefined,
      originalInvoiceId: original.id,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      deliveryDate: input.deliveryDate,
      currency: "EUR",
      note: input.reason,
      items,
      actorId: input.actorId,
    });
  }

  async cancel(invoiceId: string, reason: string, actorId: string): Promise<void> {
    if (!reason.trim()) throw new FinanceDomainError("INVALID_LINE", "Dôvod storna je povinný.");
    await prisma.$transaction(async (tx) => {
      await lockInvoice(tx, invoiceId);
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new FinanceDomainError("INVOICE_NOT_FOUND", "Faktúra neexistuje.");
      const currentStatus = asDocumentStatus(invoice.documentStatus);
      assertDocumentTransition(currentStatus, "CANCELLED");
      const cancelledAt = new Date();
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          documentStatus: "CANCELLED",
          status: "STORNO",
          cancelledAt,
          cancelledById: actorId,
          cancelReason: reason.trim(),
        },
      });
      await createAudit(tx, {
        actorId,
        action: "INVOICE_CANCELLED",
        entityId: invoice.id,
        beforeData: { documentStatus: currentStatus },
        afterData: { documentStatus: "CANCELLED", cancelledAt, reason: reason.trim() },
      });
    });
  }

  async getPaymentStatus(invoiceId: string): Promise<InvoicePaymentStatus> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        totalGrossCents: true,
        paymentAllocations: { where: { reversedAt: null }, select: { amountCents: true } },
      },
    });
    if (!invoice) throw new FinanceDomainError("INVOICE_NOT_FOUND", "Faktúra neexistuje.");
    const allocated = invoice.paymentAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
    return calculatePaymentStatus(invoice.totalGrossCents, allocated);
  }

  async exportAccounting(input: AccountingExportInput): Promise<AccountingExport> {
    const invoices = await prisma.invoice.findMany({
      where: {
        ...(input.direction ? { direction: input.direction } : {}),
        ...(input.legalEntity !== undefined ? { legalEntity: input.legalEntity } : {}),
        ...(input.source ? { source: input.source } : {}),
        documentStatus: input.includeCancelled ? { in: ["ISSUED", "CANCELLED"] } : "ISSUED",
        ...(input.dateFrom || input.dateTo
          ? {
              issueDate: {
                ...(input.dateFrom ? { gte: input.dateFrom } : {}),
                ...(input.dateTo ? { lte: input.dateTo } : {}),
              },
            }
          : {}),
      },
      include: {
        client: true,
        paymentAllocations: { where: { reversedAt: null }, select: { amountCents: true } },
      },
      orderBy: [{ issueDate: "asc" }, { invoiceNumber: "asc" }],
    });

    const csvField = (value: unknown) => {
      const text = value == null ? "" : String(value);
      return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const date = (value: Date | null) => value?.toISOString().slice(0, 10) ?? "";
    const header = [
      "Číslo",
      "Typ",
      "Smer",
      "Partner",
      "IČO",
      "Dátum vystavenia",
      "Dátum dodania",
      "Splatnosť",
      "Základ centy",
      "DPH centy",
      "Spolu centy",
      "Mena",
      "VS",
      "Stav dokladu",
      "Stav úhrady",
      "Zdroj",
      "Externé číslo",
      "Právny subjekt",
      "Krajina dane",
      "Sadzba originálu bps",
      "Overenie originálu",
      "Potvrdenie úhrady mimo ERP",
      "Mena daňových súm",
      "Pôvodný daňový základ minor",
      "Pôvodná daň minor",
      "Pôvodný daňový súčet minor",
    ];
    let totalGrossCents = 0;
    const rows = invoices.map((invoice) => {
      const snapshot = parsePartySnapshot(invoice.counterpartySnapshot);
      const allocated = invoice.paymentAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
      const paymentStatus = calculatePaymentStatus(invoice.totalGrossCents, allocated);
      const sign = invoice.documentType === "CREDIT_NOTE" ? -1 : 1;
      if (invoice.currency === "EUR") totalGrossCents += invoice.totalGrossCents * sign;
      return [
        invoice.invoiceNumber,
        invoice.documentType,
        invoice.direction,
        snapshot?.name ?? invoice.client?.name ?? invoice.supplierName,
        snapshot?.ico ?? invoice.client?.ico,
        date(invoice.issueDate),
        date(invoice.deliveryDate),
        date(invoice.dueDate),
        invoice.source === "HISTORICAL" && invoice.taxCurrency !== invoice.currency ? "" : invoice.totalNetCents * sign,
        invoice.source === "HISTORICAL" && invoice.taxCurrency !== invoice.currency ? "" : invoice.totalVatCents * sign,
        invoice.totalGrossCents * sign,
        invoice.currency,
        invoice.variableSymbol,
        invoice.documentStatus,
        invoice.source === "HISTORICAL" ? invoice.paymentConfirmation ?? "UNVERIFIED" : paymentStatus,
        invoice.source,
        invoice.externalNumber,
        invoice.legalEntity,
        invoice.taxCountry,
        invoice.foreignVatRateBps,
        invoice.verificationStatus,
        invoice.paymentConfirmation,
        invoice.taxCurrency,
        invoice.taxBaseMinor,
        invoice.taxAmountMinor,
        invoice.taxTotalMinor,
      ].map(csvField).join(";");
    });
    const content = new TextEncoder().encode(`\uFEFF${[header.join(";"), ...rows].join("\r\n")}`);
    const sha256 = createHash("sha256").update(content).digest("hex");
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      fileName: `uctovny-export-${stamp}.csv`,
      contentType: "text/csv; charset=utf-8",
      content,
      invoiceCount: invoices.length,
      totalGrossCents,
      sha256,
    };
  }
}

export const invoiceService = new PrismaInvoiceService();
