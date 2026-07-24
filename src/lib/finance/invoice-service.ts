import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextNumber } from "@/lib/invoicing";
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
  InvoiceService,
  PartySnapshot,
  TaxSnapshot,
} from "./contracts";
import {
  assertCreditWithinOriginal,
  assertDocumentTransition,
  calculateInvoice,
  calculatePaymentStatus,
  FinanceDomainError,
} from "./domain";

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
  if (!env.FINANCE_BUCKET_NAME && !env.DOCUMENT_BUCKET_NAME && !env.BUCKET) {
    blockers.push("Nie je nastavený privátny bucket pre finančné dokumenty.");
  }
  if (!env.FINANCE_MAIL_PROVIDER && !env.SMTP_HOST) {
    blockers.push("Nie je nastavený transakčný e-mailový provider.");
  }
  if ((env.FINANCE_MAIL_FROM || env.MAIL_FROM)?.toLowerCase() !== "info@zdravyshot.sk") {
    blockers.push("Odosielateľ faktúr musí byť info@zdravyshot.sk.");
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
    if (!input.actorId.trim()) throw new FinanceDomainError("INVALID_LINE", "Chýba používateľ operácie.");
    validateDraftDates(input);
    if (input.documentType === "CREDIT_NOTE" && !input.originalInvoiceId) {
      throw new FinanceDomainError("INVALID_LINE", "Dobropis musí odkazovať na pôvodnú faktúru.");
    }
    const counterparty = input.counterparty
      ? financePartySnapshotSchema.parse(input.counterparty)
      : undefined;
    const calculation = calculateInvoice({ currency: input.currency, lines: input.items });

    return prisma.$transaction(async (tx) => {
      if (input.orderId && (input.documentType ?? "INVOICE") === "INVOICE") {
        const existing = await tx.invoice.findFirst({
          where: {
            orderId: input.orderId,
            direction: input.direction,
            documentType: "INVOICE",
            documentStatus: { not: "CANCELLED" },
          },
          select: { invoiceNumber: true },
        });
        if (existing) {
          throw new FinanceDomainError(
            "INVALID_TRANSITION",
            `K objednávke už existuje ${existing.invoiceNumber ? `faktúra ${existing.invoiceNumber}` : "koncept faktúry"}.`,
          );
        }
      }
      const created = await tx.invoice.create({
        data: {
          direction: input.direction,
          documentType: input.documentType ?? "INVOICE",
          documentStatus: "DRAFT",
          source: input.source ?? "INTERNA",
          externalId: input.externalId ?? null,
          externalNumber: input.externalNumber ?? null,
          invoiceNumber: null,
          currency: input.currency,
          clientId: input.clientId ?? null,
          supplierName: input.direction === "PRIJATA" ? counterparty?.name ?? null : null,
          orderId: input.orderId ?? null,
          originalInvoiceId: input.originalInvoiceId ?? null,
          issueDate: input.issueDate,
          dueDate: input.dueDate,
          deliveryDate: input.deliveryDate ?? null,
          createdById: input.actorId,
          status: "VYSTAVENA",
          totalNetCents: calculation.totalNetCents,
          totalVatCents: calculation.totalVatCents,
          totalGrossCents: calculation.totalGrossCents,
          variableSymbol: input.variableSymbol ?? null,
          ...(counterparty ? { counterpartySnapshot: toJson(counterparty) } : {}),
          note: input.note ?? null,
          items: {
            create: calculation.lines.map((line) => ({
              productId: line.productId ?? null,
              lineNumber: line.lineNumber,
              description: line.description,
              productSku: line.productSku ?? null,
              quantity: line.quantity,
              unit: line.unit,
              unitPriceCents: line.unitPriceCents,
              vatRate: line.vatRate,
              totalNetCents: line.totalNetCents,
              totalVatCents: line.totalVatCents,
              totalGrossCents: line.totalGrossCents,
              taxCategory: line.taxCategory ?? "STANDARD",
            })),
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
        },
      });
      if (!invoice) throw new FinanceDomainError("INVOICE_NOT_FOUND", "Faktúra neexistuje.");
      if (invoice.documentStatus !== "DRAFT" || invoice.invoiceNumber) {
        throw new FinanceDomainError("INVOICE_IMMUTABLE", "Finalizovať možno iba koncept bez prideleného čísla.");
      }
      if (invoice.items.length === 0) {
        throw new FinanceDomainError("INVALID_LINE", "Faktúra nemá žiadne položky.");
      }

      const taxDate = invoice.deliveryDate ?? invoice.issueDate;
      const company = await tx.companyProfile.findFirst({
        where: {
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
      if (!company) blockers.push("Pre dátum dodania neexistuje platný firemný profil.");
      const taxProfile = company?.taxProfiles[0];
      let primaryAccount = company?.bankAccounts[0];
      if (company && !primaryAccount) {
        primaryAccount = await tx.bankAccount.findFirst({
          where: { isActive: true, isPrimary: true, currency: "EUR" },
          orderBy: { updatedAt: "desc" },
        }) ?? undefined;
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
        if (process.env.NODE_ENV === "production" && invoice.issueDate.getFullYear() === 2026) {
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

      const vatApplies =
        invoice.direction === "VYDANA" &&
        taxProfile?.vatStatus === "PAYER" &&
        !!taxProfile.vatRegisteredFrom &&
        taxDate.getTime() >= taxProfile.vatRegisteredFrom.getTime();

      const effectiveLines = [];
      for (const item of invoice.items) {
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
              validFrom: { lte: taxDate },
              OR: [{ validTo: null }, { validTo: { gte: taxDate } }],
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
          vatRate,
          taxCategory,
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
        vatStatus: taxProfile.vatStatus === "PAYER" ? "PAYER" : "NON_PAYER",
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

      const invoiceNumber = await nextNumber(
        tx,
        invoice.direction === "VYDANA" ? "VYDANA" : "PRIJATA",
        invoice.issueDate.getFullYear(),
      );
      const finalizedAt = new Date();
      assertDocumentTransition("DRAFT", "ISSUED");
      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          invoiceNumber,
          documentStatus: "ISSUED",
          finalizedAt,
          finalizedById: actorId,
          variableSymbol: invoice.variableSymbol || invoiceNumber.replace(/\D/g, ""),
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
      vatRate: item.vatRate,
      taxCategory: item.taxCategory === "EXEMPT" ? "EXEMPT" as const : "STANDARD" as const,
    }));
    const calculation = calculateInvoice({ currency: "EUR", lines: items });
    const alreadyCredited = original.creditNotes.reduce(
      (sum, creditNote) => sum + creditNote.totalGrossCents,
      0,
    );
    assertCreditWithinOriginal(original.totalGrossCents, alreadyCredited, calculation.totalGrossCents);

    return this.createDraft({
      direction: asDirection(original.direction),
      documentType: "CREDIT_NOTE",
      source: "INTERNA",
      clientId: original.clientId ?? undefined,
      counterparty: snapshot,
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
    ];
    let totalGrossCents = 0;
    const rows = invoices.map((invoice) => {
      const snapshot = parsePartySnapshot(invoice.counterpartySnapshot);
      const allocated = invoice.paymentAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
      const paymentStatus = calculatePaymentStatus(invoice.totalGrossCents, allocated);
      const sign = invoice.documentType === "CREDIT_NOTE" ? -1 : 1;
      totalGrossCents += invoice.totalGrossCents * sign;
      return [
        invoice.invoiceNumber,
        invoice.documentType,
        invoice.direction,
        snapshot?.name ?? invoice.client?.name ?? invoice.supplierName,
        snapshot?.ico ?? invoice.client?.ico,
        date(invoice.issueDate),
        date(invoice.deliveryDate),
        date(invoice.dueDate),
        invoice.totalNetCents * sign,
        invoice.totalVatCents * sign,
        invoice.totalGrossCents * sign,
        invoice.currency,
        invoice.variableSymbol,
        invoice.documentStatus,
        paymentStatus,
        invoice.source,
        invoice.externalNumber,
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
