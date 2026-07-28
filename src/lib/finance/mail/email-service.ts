import type { MailProvider } from "@/lib/finance/contracts";
import { prisma } from "@/lib/prisma";
import {
  NonRetryableError,
  SkippedOutboxError,
} from "@/lib/finance/outbox/errors";
import { MAIL_FROM, MAIL_REPLY_TO } from "./config";
import { buildInvoiceEmail, buildReminderEmail, type InvoiceEmailData } from "./templates";

export type EmailKind = "INVOICE" | "REMINDER";

export interface SendInvoiceEmailInput {
  invoiceId: string;
  kind: EmailKind;
  outboxEventId: string;
  provider: MailProvider;
  actorId?: string;
  now?: Date;
}

export interface SendInvoiceEmailResult {
  status: "SENT" | "ALREADY_SENT";
  emailDeliveryId: string;
  toAddress: string;
}

interface MailPartySnapshot {
  name?: string;
  email?: string;
  iban?: string;
}

export function mailPartyFromSnapshot(snapshot: unknown): MailPartySnapshot {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {};
  }
  const candidate = snapshot as Record<string, unknown>;
  return {
    ...(typeof candidate.name === "string" && candidate.name.trim()
      ? { name: candidate.name.trim() }
      : {}),
    ...(typeof candidate.email === "string" && candidate.email.trim()
      ? { email: candidate.email.trim() }
      : {}),
    ...(typeof candidate.iban === "string" && candidate.iban.trim()
      ? { iban: candidate.iban.trim() }
      : {}),
  };
}

/**
 * Odošle e-mail s faktúrou/upomienkou a eviduje výsledok v EmailDelivery.
 * Idempotentné podľa outboxEventId — ak už bolo SENT, znovu neodosiela.
 * Pri chybe providera aktualizuje EmailDelivery a chybu prehodí (worker
 * naplánuje retry). NonRetryableError = terminálny stav bez opakovania.
 */
export async function sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<SendInvoiceEmailResult> {
  const now = input.now ?? new Date();
  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    select: {
      id: true,
      direction: true,
      documentStatus: true,
      documentType: true,
      invoiceNumber: true,
      totalGrossCents: true,
      variableSymbol: true,
      dueDate: true,
      issuerSnapshot: true,
      counterpartySnapshot: true,
      paymentAllocations: {
        where: { reversedAt: null },
        select: { amountCents: true },
      },
    },
  });
  if (!invoice) throw new NonRetryableError("Faktúra neexistuje.");
  if (invoice.direction !== "VYDANA") throw new NonRetryableError("E-mailom sa posielajú len vydané doklady.");
  if (invoice.documentStatus !== "ISSUED" || !invoice.invoiceNumber) {
    throw new NonRetryableError("Doklad nie je finalizovaný.");
  }

  const recipient = mailPartyFromSnapshot(invoice.counterpartySnapshot);
  const toAddress = recipient.email;
  if (!toAddress) {
    throw new NonRetryableError(
      `Snapshot odberateľa ${recipient.name ?? ""} nemá e-mailovú adresu.`,
    );
  }
  const paidCents = invoice.paymentAllocations.reduce(
    (sum, allocation) => sum + allocation.amountCents,
    0,
  );
  const outstandingCents = Math.max(0, invoice.totalGrossCents - paidCents);
  if (input.kind === "REMINDER" && outstandingCents === 0) {
    throw new SkippedOutboxError("Faktúra už bola uhradená.");
  }

  // Existujúca evidencia pre túto outbox udalosť → idempotencia
  const existing = await prisma.emailDelivery.findUnique({ where: { outboxEventId: input.outboxEventId } });
  if (existing?.status === "SENT" || existing?.status === "DELIVERED") {
    return { status: "ALREADY_SENT", emailDeliveryId: existing.id, toAddress: existing.toAddress };
  }

  // PDF príloha — najnovší nemenný dokument faktúry
  const document = await prisma.documentAsset.findFirst({
    where: {
      invoiceId: invoice.id,
      type:
        invoice.documentType === "CREDIT_NOTE"
          ? "CREDIT_NOTE_PDF"
          : "INVOICE_PDF",
      archivedAt: null,
      isImmutable: true,
    },
    orderBy: { createdAt: "desc" },
  });
  // Pri odoslaní faktúry je PDF povinné (je to samotný doklad); upomienka sa
  // pošle aj bez PDF (text obsahuje všetky platobné údaje) — napr. pre
  // staršie doklady bez vygenerovaného PDF.
  if (!document && input.kind === "INVOICE") {
    // PDF ešte nie je vygenerované — retryovateľné (worker to skúsi po PDF kroku)
    throw new Error("PDF dokladu ešte nie je vygenerované.");
  }

  const issuer = mailPartyFromSnapshot(invoice.issuerSnapshot);
  const emailData: InvoiceEmailData = {
    invoiceNumber: invoice.invoiceNumber,
    documentType: invoice.documentType === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE",
    clientName: recipient.name ?? "",
    totalGrossCents:
      input.kind === "REMINDER" ? outstandingCents : invoice.totalGrossCents,
    variableSymbol: invoice.variableSymbol,
    iban: issuer.iban ?? null,
    dueDate: invoice.dueDate,
    issuerName: issuer.name ?? "Zdravý Shot",
  };

  const daysOverdue = Math.max(
    0,
    Math.floor(
      (now.getTime() - invoice.dueDate.getTime()) /
        (24 * 3600 * 1000),
    ),
  );
  const content =
    input.kind === "REMINDER"
      ? buildReminderEmail({ ...emailData, daysOverdue })
      : buildInvoiceEmail(emailData);

  // Založ/aktualizuj EmailDelivery ako pokus
  const delivery = existing
    ? await prisma.emailDelivery.update({
        where: { id: existing.id },
        data: { attemptCount: { increment: 1 }, lastAttemptAt: now, status: "PENDING", subject: content.subject },
      })
    : await prisma.emailDelivery.create({
        data: {
          invoiceId: invoice.id,
          documentId: document?.id ?? null,
          outboxEventId: input.outboxEventId,
          provider: input.provider.providerName,
          fromAddress: MAIL_FROM,
          toAddress,
          subject: content.subject,
          status: "PENDING",
          attemptCount: 1,
          lastAttemptAt: now,
        },
      });

  try {
    const result = await input.provider.send({
      idempotencyKey: input.outboxEventId,
      invoiceId: invoice.id,
      from: MAIL_FROM,
      to: [toAddress],
      replyTo: MAIL_REPLY_TO,
      subject: content.subject,
      text: content.text,
      html: content.html,
      documentIds: document ? [document.id] : [],
    });

    await prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "SENT",
        providerMessageId: result.providerMessageId,
        sentAt: result.submittedAt,
        errorCode: null,
        errorMessage: null,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.kind === "REMINDER" ? "REMINDER_EMAIL_SENT" : "INVOICE_EMAIL_SENT",
        entityType: "Invoice",
        entityId: invoice.id,
        metadata: { toAddress, providerMessageId: result.providerMessageId, emailDeliveryId: delivery.id },
      },
    });
    return { status: "SENT", emailDeliveryId: delivery.id, toAddress };
  } catch (error) {
    await prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
