import type { MailProvider } from "@/lib/finance/contracts";
import { prisma } from "@/lib/prisma";
import { NonRetryableError } from "@/lib/finance/outbox/errors";
import { MAIL_FROM, MAIL_REPLY_TO } from "./config";
import { buildInvoiceEmail, buildReminderEmail, type InvoiceEmailData } from "./templates";

export type EmailKind = "INVOICE" | "REMINDER";

export interface SendInvoiceEmailInput {
  invoiceId: string;
  kind: EmailKind;
  outboxEventId: string;
  provider: MailProvider;
}

export interface SendInvoiceEmailResult {
  status: "SENT" | "ALREADY_SENT";
  emailDeliveryId: string;
  toAddress: string;
}

interface IssuerSnapshotShape {
  name?: string;
  iban?: string;
}

/**
 * Odošle e-mail s faktúrou/upomienkou a eviduje výsledok v EmailDelivery.
 * Idempotentné podľa outboxEventId — ak už bolo SENT, znovu neodosiela.
 * Pri chybe providera aktualizuje EmailDelivery a chybu prehodí (worker
 * naplánuje retry). NonRetryableError = terminálny stav bez opakovania.
 */
export async function sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<SendInvoiceEmailResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    include: { client: true },
  });
  if (!invoice) throw new NonRetryableError("Faktúra neexistuje.");
  if (invoice.direction !== "VYDANA") throw new NonRetryableError("E-mailom sa posielajú len vydané doklady.");
  if (invoice.documentStatus !== "ISSUED" || !invoice.invoiceNumber) {
    throw new NonRetryableError("Doklad nie je finalizovaný.");
  }

  const toAddress = invoice.client?.email?.trim();
  if (!toAddress) {
    throw new NonRetryableError(`Klient ${invoice.client?.name ?? ""} nemá e-mailovú adresu.`);
  }

  // Existujúca evidencia pre túto outbox udalosť → idempotencia
  const existing = await prisma.emailDelivery.findUnique({ where: { outboxEventId: input.outboxEventId } });
  if (existing?.status === "SENT") {
    return { status: "ALREADY_SENT", emailDeliveryId: existing.id, toAddress: existing.toAddress };
  }

  // PDF príloha — najnovší nemenný dokument faktúry
  const document = await prisma.documentAsset.findFirst({
    where: {
      invoiceId: invoice.id,
      type: { in: ["INVOICE_PDF", "CREDIT_NOTE_PDF"] },
      archivedAt: null,
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

  const issuer = (invoice.issuerSnapshot ?? {}) as IssuerSnapshotShape;
  const emailData: InvoiceEmailData = {
    invoiceNumber: invoice.invoiceNumber,
    documentType: invoice.documentType === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE",
    clientName: invoice.client?.name ?? "",
    totalGrossCents: invoice.totalGrossCents,
    variableSymbol: invoice.variableSymbol,
    iban: issuer.iban ?? null,
    dueDate: invoice.dueDate,
    issuerName: issuer.name ?? "Zdravý Shot",
  };

  const daysOverdue = Math.max(
    0,
    Math.floor((Date.now() - invoice.dueDate.getTime()) / (24 * 3600 * 1000)),
  );
  const content =
    input.kind === "REMINDER"
      ? buildReminderEmail({ ...emailData, daysOverdue })
      : buildInvoiceEmail(emailData);

  // Založ/aktualizuj EmailDelivery ako pokus
  const delivery = existing
    ? await prisma.emailDelivery.update({
        where: { id: existing.id },
        data: { attemptCount: { increment: 1 }, lastAttemptAt: new Date(), status: "PENDING", subject: content.subject },
      })
    : await prisma.emailDelivery.create({
        data: {
          invoiceId: invoice.id,
          documentId: document?.id ?? null,
          outboxEventId: input.outboxEventId,
          provider: "SMTP",
          fromAddress: MAIL_FROM,
          toAddress,
          subject: content.subject,
          status: "PENDING",
          attemptCount: 1,
          lastAttemptAt: new Date(),
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
