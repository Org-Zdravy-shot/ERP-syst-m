import { prisma } from "@/lib/prisma";
import { enqueueOutbox } from "./enqueue";

/** Po koľkých dňoch po splatnosti sa posiela prvá upomienka. */
export const REMINDER_GRACE_DAYS = Number.parseInt(process.env.REMINDER_GRACE_DAYS ?? "3", 10) || 3;

/** Týždenný bucket — najviac jedna upomienka na faktúru za 7 dní. */
function weekBucket(date: Date): number {
  return Math.floor(date.getTime() / (7 * 24 * 3600 * 1000));
}

export interface RemindersSummary {
  candidates: number;
  enqueued: number;
}

/**
 * Zaradí upomienky pre vydané, finalizované, neuhradené faktúry po splatnosti
 * (výška zostatku zo súčtu aktívnych alokácií — konzistentné s párovaním).
 * Idempotentné: rovnaká faktúra dostane v jednom týždni najviac jednu upomienku.
 * Reálne odoslanie robí outbox worker.
 */
export async function enqueueDueReminders(now: Date = new Date()): Promise<RemindersSummary> {
  const cutoff = new Date(now.getTime() - REMINDER_GRACE_DAYS * 24 * 3600 * 1000);

  const overdue = await prisma.invoice.findMany({
    where: {
      direction: "VYDANA",
      documentType: "INVOICE",
      documentStatus: "ISSUED",
      // legacy UHRADENA (historicky uhradené bez alokácií) sa do A1 backfillu
      // rešpektuje ako uzavreté — nespamovať upomienkami; STORNO tiež nie
      status: { notIn: ["UHRADENA", "STORNO"] },
      dueDate: { lt: cutoff },
      client: { email: { not: null } },
    },
    select: {
      id: true,
      totalGrossCents: true,
      paymentAllocations: { where: { reversedAt: null }, select: { amountCents: true } },
    },
  });

  const bucket = weekBucket(now);
  let enqueued = 0;

  for (const invoice of overdue) {
    const paid = invoice.paymentAllocations.reduce((sum, a) => sum + a.amountCents, 0);
    if (invoice.totalGrossCents - paid <= 0) continue; // uhradená

    const result = await enqueueOutbox({
      type: "REMINDER_EMAIL",
      aggregateType: "Invoice",
      aggregateId: invoice.id,
      idempotencyKey: `invoice:${invoice.id}:reminder:${bucket}`,
      payload: { invoiceId: invoice.id },
    });
    if (result.created) enqueued += 1;
  }

  return { candidates: overdue.length, enqueued };
}
