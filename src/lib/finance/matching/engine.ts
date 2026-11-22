import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { InvoicePaymentStatus } from "@/lib/finance/contracts";
import { calculatePaymentStatus } from "@/lib/finance/domain";
import { classifyPayment, normalizeIban, type InvoiceCandidate, type MatchOutcome } from "./match";

type Tx = Prisma.TransactionClient;

/**
 * DB vrstva párovania: alokácie platieb, prepočet paymentStatus a audit.
 * paymentStatus sa NIKDY nenastavuje ručne — vždy sa počíta zo súčtu
 * aktívnych alokácií (docs/FINANCE_V2_IMPLEMENTATION_PLAN.md §3.1).
 */

export async function invoiceOutstandingCents(tx: Tx, invoiceId: string): Promise<number> {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { totalGrossCents: true },
  });
  const allocated = await tx.paymentAllocation.aggregate({
    where: { invoiceId, reversedAt: null },
    _sum: { amountCents: true },
  });
  return invoice.totalGrossCents - (allocated._sum.amountCents ?? 0);
}

export async function recomputePaymentStatus(
  tx: Tx,
  invoiceId: string,
): Promise<InvoicePaymentStatus> {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { totalGrossCents: true },
  });
  const allocated = await tx.paymentAllocation.aggregate({
    where: { invoiceId, reversedAt: null },
    _sum: { amountCents: true },
  });
  return calculatePaymentStatus(invoice.totalGrossCents, allocated._sum.amountCents ?? 0);
}

async function lockPayment(tx: Tx, paymentId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`,
  );
  if (rows.length === 0) throw new Error("Platba neexistuje.");
}

async function lockInvoice(tx: Tx, invoiceId: string): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ documentStatus: string }>>(
    Prisma.sql`SELECT "documentStatus" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`,
  );
  const invoice = rows[0];
  if (!invoice) throw new Error("Faktúra neexistuje.");
  return invoice.documentStatus;
}

function snapshotIban(value: Prisma.JsonValue | null): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const iban = (value as { iban?: unknown }).iban;
  return typeof iban === "string" && iban.trim() ? iban : null;
}

async function audit(
  tx: Tx,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Prisma.InputJsonValue,
  actorId?: string | null,
) {
  await tx.auditLog.create({
    data: { action, entityType, entityId, metadata, actorId: actorId ?? null },
  });
}

export async function paymentUnallocatedCents(tx: Tx, paymentId: string): Promise<number> {
  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: { amountCents: true },
  });
  const allocated = await tx.paymentAllocation.aggregate({
    where: { paymentId, reversedAt: null },
    _sum: { amountCents: true },
  });
  return Math.abs(payment.amountCents) - (allocated._sum.amountCents ?? 0);
}

/**
 * Kandidátske faktúry pre prichádzajúcu platbu: vydané, finalizované,
 * s kladným zostatkom vypočítaným výhradne z aktívnych alokácií.
 */
async function openInvoiceCandidates(
  tx: Tx,
  legalEntity: string,
  recipientIban: string,
  currency: string,
): Promise<InvoiceCandidate[]> {
  const invoices = await tx.invoice.findMany({
    where: {
      direction: "VYDANA",
      documentType: "INVOICE",
      documentStatus: "ISSUED",
      legalEntity,
      currency,
    },
    select: {
      id: true,
      variableSymbol: true,
      currency: true,
      dueDate: true,
      totalGrossCents: true,
      issuerSnapshot: true,
      counterpartySnapshot: true,
      client: { select: { iban: true } },
      paymentAllocations: {
        where: { reversedAt: null },
        select: { amountCents: true },
      },
    },
  });

  return invoices
    .filter((inv) => normalizeIban(snapshotIban(inv.issuerSnapshot)) === recipientIban)
    .map((inv) => ({
      invoiceId: inv.id,
      variableSymbol: inv.variableSymbol,
      clientIban: snapshotIban(inv.counterpartySnapshot) ?? inv.client?.iban ?? null,
      outstandingCents:
        inv.totalGrossCents - inv.paymentAllocations.reduce((sum, a) => sum + a.amountCents, 0),
      currency: inv.currency,
      dueDate: inv.dueDate,
    }))
    .filter((inv) => inv.outstandingCents > 0);
}

export interface AutoMatchResult {
  paymentId: string;
  outcome: MatchOutcome;
  /** true = platba sa párovania netýka (odchádzajúca / už alokovaná) */
  skipped?: boolean;
}

/**
 * Automatické párovanie jednej platby. Alokácia vznikne LEN pri plnej,
 * jednoznačnej zhode — čiastočné/nadmerné/nejednoznačné ostávajú na
 * manuálnu kontrolu (/financie/banka/parovanie).
 */
export async function autoMatchPayment(paymentId: string): Promise<AutoMatchResult> {
  return prisma.$transaction(async (tx) => {
    await lockPayment(tx, paymentId);
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        bankTransaction: {
          select: {
            bankAccount: { select: { iban: true, companyProfile: { select: { legalEntity: true } } } },
          },
        },
      },
    });

    const unallocated = await paymentUnallocatedCents(tx, paymentId);
    if (payment.direction !== "INCOMING" || unallocated <= 0) {
      return {
        paymentId,
        outcome: { type: "MANUAL", reason: "Platba už je alokovaná alebo je odchádzajúca.", candidateInvoiceIds: [] },
        skipped: true,
      } satisfies AutoMatchResult;
    }

    const account = payment.bankTransaction?.bankAccount;
    const legalEntity = account?.companyProfile?.legalEntity;
    const recipientIban = normalizeIban(account?.iban);
    if (!legalEntity || !recipientIban) {
      return {
        paymentId,
        outcome: { type: "MANUAL", reason: "Účet výpisu nemá priradeného vystavovateľa.", candidateInvoiceIds: [] },
      } satisfies AutoMatchResult;
    }

    const outcome = classifyPayment(
      {
        amountCents: unallocated,
        currency: payment.currency,
        paidAt: payment.paidAt,
        variableSymbol: payment.variableSymbol,
        counterpartyIban: payment.counterpartyIban,
      },
      await openInvoiceCandidates(tx, legalEntity, recipientIban, payment.currency),
    );

    if (outcome.type === "AUTO") {
      const documentStatus = await lockInvoice(tx, outcome.invoiceId);
      const outstandingCents = await invoiceOutstandingCents(tx, outcome.invoiceId);
      if (documentStatus !== "ISSUED" || outstandingCents !== unallocated) {
        return {
          paymentId,
          outcome: {
            type: "MANUAL",
            reason: "Faktúra sa počas párovania zmenila — vyžaduje kontrolu.",
            candidateInvoiceIds: [outcome.invoiceId],
          },
        };
      }
      await tx.paymentAllocation.create({
        data: {
          paymentId,
          invoiceId: outcome.invoiceId,
          amountCents: unallocated,
        },
      });
      await recomputePaymentStatus(tx, outcome.invoiceId);
      await audit(tx, "PAYMENT_AUTO_MATCHED", "Payment", paymentId, {
        rule: outcome.rule,
        invoiceId: outcome.invoiceId,
        amountCents: unallocated,
      });
    }

    return { paymentId, outcome };
  });
}

/** Manuálna alokácia (aj čiastočná) z obrazovky kontroly. */
export async function allocatePayment(
  paymentId: string,
  invoiceId: string,
  amountCents: number,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (amountCents <= 0) throw new Error("Alokovaná suma musí byť kladná.");

    await lockPayment(tx, paymentId);
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { direction: true, currency: true },
    });
    const unallocated = await paymentUnallocatedCents(tx, paymentId);
    if (amountCents > unallocated) {
      throw new Error(
        `Alokácia prevyšuje nealokovaný zostatok platby (${(unallocated / 100).toFixed(2)} €).`,
      );
    }

    const documentStatus = await lockInvoice(tx, invoiceId);
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { direction: true, currency: true },
    });
    if (documentStatus !== "ISSUED") throw new Error("Alokovať možno len na finalizovanú faktúru.");
    const expectedDirection = payment.direction === "INCOMING" ? "VYDANA" : "PRIJATA";
    if (invoice.direction !== expectedDirection) {
      throw new Error(
        payment.direction === "INCOMING"
          ? "Prijatú platbu možno alokovať len na vydanú faktúru."
          : "Odchádzajúcu platbu možno alokovať len na prijatú faktúru.",
      );
    }
    if (invoice.currency !== payment.currency) {
      throw new Error("Mena platby sa nezhoduje s menou faktúry.");
    }

    const existing = await tx.paymentAllocation.findUnique({
      where: { paymentId_invoiceId: { paymentId, invoiceId } },
    });
    if (existing && existing.reversedAt === null) {
      throw new Error("Platba už má aktívnu alokáciu na túto faktúru.");
    }
    if (existing) {
      await tx.paymentAllocation.update({
        where: { id: existing.id },
        data: { amountCents, reversedAt: null, reversedById: null, reverseReason: null, createdById: actorId },
      });
    } else {
      await tx.paymentAllocation.create({
        data: { paymentId, invoiceId, amountCents, createdById: actorId },
      });
    }

    await recomputePaymentStatus(tx, invoiceId);
    await audit(
      tx,
      "PAYMENT_MANUALLY_ALLOCATED",
      "Payment",
      paymentId,
      { invoiceId, amountCents },
      actorId,
    );
  });
}

/** Zrušenie alokácie — alokácia sa nemaže, označí sa reversedAt (audit trail). */
export async function reverseAllocation(
  allocationId: string,
  actorId: string,
  reason: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const allocation = await tx.paymentAllocation.findUniqueOrThrow({ where: { id: allocationId } });
    if (allocation.reversedAt !== null) throw new Error("Alokácia už bola zrušená.");

    await tx.paymentAllocation.update({
      where: { id: allocationId },
      data: { reversedAt: new Date(), reversedById: actorId, reverseReason: reason },
    });
    await recomputePaymentStatus(tx, allocation.invoiceId);
    await audit(
      tx,
      "PAYMENT_ALLOCATION_REVERSED",
      "PaymentAllocation",
      allocationId,
      { invoiceId: allocation.invoiceId, reason },
      actorId,
    );
  });
}
