import type { DocumentService, MailProvider } from "@/lib/finance/contracts";
import { prisma } from "@/lib/prisma";
import { sendInvoiceEmail } from "@/lib/finance/mail/email-service";
import { MAIL_MAX_ATTEMPTS } from "@/lib/finance/mail/config";
import { getMailProvider, getWorkerDocumentService } from "./composition";
import { enqueueOutbox } from "./enqueue";
import { NonRetryableError } from "./errors";
import { decideRetry } from "./retry-policy";

export const OUTBOX_MAX_ATTEMPTS = MAIL_MAX_ATTEMPTS;

export interface OutboxDeps {
  documentService: DocumentService;
  mailProvider: MailProvider;
  now: () => Date;
}

function defaultDeps(): OutboxDeps {
  return {
    documentService: getWorkerDocumentService(),
    mailProvider: getMailProvider(),
    now: () => new Date(),
  };
}

interface PdfPayload {
  invoiceId: string;
}

/**
 * Atomicky uchmatne jednu čakajúcu udalosť: prepne PENDING→PROCESSING iba
 * ak ju medzitým nevzal iný beh (updateMany count===1). Vracia null keď
 * nie je čo spracovať.
 */
async function claimNext(now: Date): Promise<{ id: string; type: string; payload: unknown; attempts: number } | null> {
  const candidate = await prisma.outboxEvent.findFirst({
    where: { status: "PENDING", availableAt: { lte: now } },
    orderBy: { availableAt: "asc" },
    select: { id: true },
  });
  if (!candidate) return null;

  const claimed = await prisma.outboxEvent.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: { status: "PROCESSING", lockedAt: now },
  });
  if (claimed.count !== 1) return null; // vzal ju iný beh — skús ďalšiu

  const event = await prisma.outboxEvent.findUniqueOrThrow({
    where: { id: candidate.id },
    select: { id: true, type: true, payload: true, attempts: true },
  });
  return event;
}

async function markDone(id: string, now: Date): Promise<void> {
  await prisma.outboxEvent.update({
    where: { id },
    data: { status: "DONE", processedAt: now, lockedAt: null, lastError: null },
  });
}

async function markFailedTerminal(id: string, error: string, now: Date): Promise<void> {
  await prisma.outboxEvent.update({
    where: { id },
    data: { status: "FAILED", processedAt: now, lockedAt: null, lastError: error },
  });
}

async function scheduleRetryOrFail(
  id: string,
  attempts: number,
  error: string,
  now: Date,
): Promise<"retry" | "failed"> {
  const decision = decideRetry(attempts, OUTBOX_MAX_ATTEMPTS);
  if (decision.action === "fail") {
    await prisma.outboxEvent.update({
      where: { id },
      data: { status: "FAILED", attempts: decision.nextAttempts, lockedAt: null, lastError: error, processedAt: now },
    });
    return "failed";
  }
  await prisma.outboxEvent.update({
    where: { id },
    data: {
      status: "PENDING",
      attempts: decision.nextAttempts,
      lockedAt: null,
      lastError: error,
      availableAt: new Date(now.getTime() + decision.delayMs),
    },
  });
  return "retry";
}

/** Spracuje jednu udalosť podľa typu. Vyhodí chybu → volajúci rozhodne o retry. */
async function dispatch(
  event: { id: string; type: string; payload: unknown },
  deps: OutboxDeps,
): Promise<void> {
  const payload = (event.payload ?? {}) as PdfPayload;

  switch (event.type) {
    case "INVOICE_PDF": {
      if (!payload.invoiceId) throw new NonRetryableError("Chýba invoiceId v payloade.");
      await deps.documentService.generateAndStoreInvoicePdf(payload.invoiceId);

      // Po PDF: ak je to vydaná faktúra a klient má e-mail, zaraď odoslanie.
      const invoice = await prisma.invoice.findUnique({
        where: { id: payload.invoiceId },
        include: { client: { select: { email: true } } },
      });
      if (invoice?.direction === "VYDANA" && invoice.client?.email) {
        await enqueueOutbox({
          type: "INVOICE_EMAIL",
          aggregateType: "Invoice",
          aggregateId: payload.invoiceId,
          idempotencyKey: `invoice:${payload.invoiceId}:auto-email`,
          payload: { invoiceId: payload.invoiceId },
        });
      }
      return;
    }
    case "INVOICE_EMAIL": {
      if (!payload.invoiceId) throw new NonRetryableError("Chýba invoiceId v payloade.");
      await sendInvoiceEmail({
        invoiceId: payload.invoiceId,
        kind: "INVOICE",
        outboxEventId: event.id,
        provider: deps.mailProvider,
      });
      return;
    }
    case "REMINDER_EMAIL": {
      if (!payload.invoiceId) throw new NonRetryableError("Chýba invoiceId v payloade.");
      await sendInvoiceEmail({
        invoiceId: payload.invoiceId,
        kind: "REMINDER",
        outboxEventId: event.id,
        provider: deps.mailProvider,
      });
      return;
    }
    default:
      throw new NonRetryableError(`Neznámy typ outbox udalosti: ${event.type}`);
  }
}

export interface OutboxRunSummary {
  processed: number;
  done: number;
  retried: number;
  failed: number;
}

/**
 * Spracuje čakajúce outbox udalosti (do `limit`). Idempotentné a bezpečné
 * na opakované spustenie (cron aj UI). Volá sa z /api/cron/outbox.
 */
export async function processPendingOutbox(
  limit = 25,
  depsOverride?: Partial<OutboxDeps>,
): Promise<OutboxRunSummary> {
  const deps = { ...defaultDeps(), ...depsOverride };
  const summary: OutboxRunSummary = { processed: 0, done: 0, retried: 0, failed: 0 };

  for (let i = 0; i < limit; i++) {
    const now = deps.now();
    const event = await claimNext(now);
    if (!event) break;
    summary.processed += 1;

    try {
      await dispatch(event, deps);
      await markDone(event.id, deps.now());
      summary.done += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof NonRetryableError) {
        await markFailedTerminal(event.id, message, deps.now());
        summary.failed += 1;
      } else {
        const outcome = await scheduleRetryOrFail(event.id, event.attempts, message, deps.now());
        if (outcome === "retry") summary.retried += 1;
        else summary.failed += 1;
      }
    }
  }

  return summary;
}
