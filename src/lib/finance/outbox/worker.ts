import type { DocumentService, MailProvider } from "@/lib/finance/contracts";
import { prisma } from "@/lib/prisma";
import { sendInvoiceEmail } from "@/lib/finance/mail/email-service";
import { MAIL_MAX_ATTEMPTS } from "@/lib/finance/mail/config";
import { getMailProvider, getWorkerDocumentService } from "./composition";
import { enqueueOutbox } from "./enqueue";
import { NonRetryableError, SkippedOutboxError } from "./errors";
import { decideRetry } from "./retry-policy";

export const OUTBOX_MAX_ATTEMPTS = MAIL_MAX_ATTEMPTS;
export const OUTBOX_LOCK_TIMEOUT_MS = 15 * 60 * 1000;

export interface OutboxDeps {
  documentService?: DocumentService;
  mailProvider?: MailProvider;
  now: () => Date;
}

interface PdfPayload {
  invoiceId: string;
  actorId?: string;
  emailIdempotencyKey?: string;
}

function snapshotEmail(snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return undefined;
  }
  const email = (snapshot as { email?: unknown }).email;
  return typeof email === "string" && email.trim() ? email.trim() : undefined;
}

/**
 * Atomicky uchmatne jednu čakajúcu udalosť: prepne PENDING→PROCESSING iba
 * ak ju medzitým nevzal iný beh (updateMany count===1). Vracia null keď
 * nie je čo spracovať.
 */
async function claimNext(now: Date): Promise<{
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
} | null> {
  for (let raceAttempt = 0; raceAttempt < 5; raceAttempt += 1) {
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
    if (claimed.count !== 1) continue;

    return prisma.outboxEvent.findUniqueOrThrow({
      where: { id: candidate.id },
      select: { id: true, type: true, payload: true, attempts: true },
    });
  }
  return null;
}

async function markDone(id: string, now: Date): Promise<void> {
  await prisma.outboxEvent.update({
    where: { id },
    data: { status: "DONE", processedAt: now, lockedAt: null, lastError: null },
  });
}

async function markFailedTerminal(
  id: string,
  attempts: number,
  error: string,
  now: Date,
): Promise<void> {
  await prisma.outboxEvent.update({
    where: { id },
    data: {
      status: "FAILED",
      attempts: attempts + 1,
      processedAt: now,
      lockedAt: null,
      lastError: error,
    },
  });
}

async function recoverStaleEvents(now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - OUTBOX_LOCK_TIMEOUT_MS);
  const error = "Predchádzajúce spracovanie prekročilo časový limit.";

  await prisma.outboxEvent.updateMany({
    where: {
      status: "PROCESSING",
      lockedAt: { lt: staleBefore },
      attempts: { gte: OUTBOX_MAX_ATTEMPTS - 1 },
    },
    data: {
      status: "FAILED",
      attempts: { increment: 1 },
      lockedAt: null,
      processedAt: now,
      lastError: error,
    },
  });
  await prisma.outboxEvent.updateMany({
    where: {
      status: "PROCESSING",
      lockedAt: { lt: staleBefore },
      attempts: { lt: OUTBOX_MAX_ATTEMPTS - 1 },
    },
    data: {
      status: "PENDING",
      attempts: { increment: 1 },
      availableAt: now,
      lockedAt: null,
      lastError: error,
    },
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
      const documentService =
        deps.documentService ?? getWorkerDocumentService();
      await documentService.generateAndStoreInvoicePdf(payload.invoiceId);

      // Po PDF: príjemcu berieme z nemenného snapshotu finalizovaného dokladu.
      const invoice = await prisma.invoice.findUnique({
        where: { id: payload.invoiceId },
        select: { direction: true, counterpartySnapshot: true },
      });
      if (
        invoice?.direction === "VYDANA" &&
        snapshotEmail(invoice.counterpartySnapshot)
      ) {
        await enqueueOutbox({
          type: "INVOICE_EMAIL",
          aggregateType: "Invoice",
          aggregateId: payload.invoiceId,
          idempotencyKey:
            payload.emailIdempotencyKey ??
            `invoice:${payload.invoiceId}:auto-email`,
          payload: {
            invoiceId: payload.invoiceId,
            ...(payload.actorId ? { actorId: payload.actorId } : {}),
          },
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
        provider: deps.mailProvider ?? getMailProvider(),
        actorId: payload.actorId,
        now: deps.now(),
      });
      return;
    }
    case "REMINDER_EMAIL": {
      if (!payload.invoiceId) throw new NonRetryableError("Chýba invoiceId v payloade.");
      await sendInvoiceEmail({
        invoiceId: payload.invoiceId,
        kind: "REMINDER",
        outboxEventId: event.id,
        provider: deps.mailProvider ?? getMailProvider(),
        actorId: payload.actorId,
        now: deps.now(),
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
  const deps: OutboxDeps = {
    now: () => new Date(),
    ...depsOverride,
  };
  const summary: OutboxRunSummary = { processed: 0, done: 0, retried: 0, failed: 0 };
  await recoverStaleEvents(deps.now());

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
      if (error instanceof SkippedOutboxError) {
        await markDone(event.id, deps.now());
        summary.done += 1;
      } else if (error instanceof NonRetryableError) {
        await markFailedTerminal(
          event.id,
          event.attempts,
          message,
          deps.now(),
        );
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
