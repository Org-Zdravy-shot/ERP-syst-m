"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { mailPartyFromSnapshot } from "@/lib/finance/mail/email-service";
import { enqueueOutbox } from "@/lib/finance/outbox/enqueue";
import { processPendingOutbox } from "@/lib/finance/outbox/worker";

export interface EmailActionState {
  error?: string;
  success?: string;
}

/**
 * Manuálne odoslanie (alebo opätovné odoslanie) faktúry e-mailom.
 * Zaradí novú INVOICE_EMAIL udalosť a hneď ju spracuje cez outbox worker,
 * takže výsledok vidno okamžite. Číslovanie/PDF idempotentne rieši worker.
 */
export async function sendInvoiceEmailNow(
  invoiceId: string,
  _prev: EmailActionState,
  _formData: FormData,
): Promise<EmailActionState> {
  const user = await requireFinancePermission("SEND_DOCUMENT");

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      direction: true,
      documentStatus: true,
      counterpartySnapshot: true,
      documents: {
        where: {
          archivedAt: null,
          isImmutable: true,
          type: { in: ["INVOICE_PDF", "CREDIT_NOTE_PDF"] },
        },
        select: { id: true },
      },
    },
  });
  if (!invoice) return { error: "Faktúra neexistuje." };
  if (invoice.direction !== "VYDANA") return { error: "E-mailom sa posielajú len vydané doklady." };
  if (invoice.documentStatus !== "ISSUED") return { error: "Doklad musí byť najskôr finalizovaný." };
  if (!mailPartyFromSnapshot(invoice.counterpartySnapshot).email) {
    return { error: "Snapshot odberateľa nemá e-mailovú adresu." };
  }

  const recentlyQueued = await prisma.outboxEvent.findFirst({
    where: {
      aggregateId: invoiceId,
      type: { in: ["INVOICE_PDF", "INVOICE_EMAIL"] },
      createdAt: { gte: new Date(Date.now() - 30_000) },
    },
    select: { id: true },
  });
  if (recentlyQueued) {
    return {
      error:
        "Odoslanie tejto faktúry už bolo práve zaradené. Skontrolujte stav o chvíľu.",
    };
  }

  const emailIdempotencyKey =
    `invoice:${invoiceId}:manual-email:${randomUUID()}`;

  // Ak PDF ešte nie je, zaraď jeho vygenerovanie (worker potom reťazovo pošle e-mail).
  let rootEventId: string;
  if (invoice.documents.length === 0) {
    const queued = await enqueueOutbox({
      type: "INVOICE_PDF",
      aggregateType: "Invoice",
      aggregateId: invoiceId,
      idempotencyKey: `invoice:${invoiceId}:manual-pdf:${randomUUID()}`,
      payload: {
        invoiceId,
        actorId: user.userId,
        emailIdempotencyKey,
      },
    });
    rootEventId = queued.eventId;
  } else {
    const queued = await enqueueOutbox({
      type: "INVOICE_EMAIL",
      aggregateType: "Invoice",
      aggregateId: invoiceId,
      idempotencyKey: emailIdempotencyKey,
      payload: { invoiceId, actorId: user.userId },
    });
    rootEventId = queued.eventId;
  }

  try {
    await processPendingOutbox(100);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Odoslanie sa nepodarilo spracovať.",
    };
  }

  revalidatePath(`/financie/faktury/${invoiceId}`);

  const emailEvent = await prisma.outboxEvent.findUnique({
    where: { idempotencyKey: emailIdempotencyKey },
    include: {
      emailDelivery: {
        select: { status: true, errorMessage: true },
      },
    },
  });
  if (
    emailEvent?.emailDelivery?.status === "SENT" ||
    emailEvent?.emailDelivery?.status === "DELIVERED"
  ) {
    return { success: "Faktúra bola odoslaná e-mailom odberateľovi." };
  }

  const rootEvent = await prisma.outboxEvent.findUnique({
    where: { id: rootEventId },
    select: { status: true, lastError: true },
  });
  const failedEvent =
    emailEvent?.status === "FAILED"
      ? emailEvent
      : rootEvent?.status === "FAILED"
        ? rootEvent
        : null;
  if (failedEvent) {
    return {
      error:
        emailEvent?.emailDelivery?.errorMessage ??
        failedEvent.lastError ??
        "Odoslanie zlyhalo — skúste znova.",
    };
  }
  return {
    success: "Odoslanie bolo zaradené a worker ho dokončí automaticky.",
  };
}
