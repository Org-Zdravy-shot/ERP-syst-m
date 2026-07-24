"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireFinancePermission } from "@/lib/finance/permissions";
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
  await requireFinancePermission("CREATE_DRAFT");

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { client: { select: { email: true } }, documents: { where: { archivedAt: null }, select: { id: true } } },
  });
  if (!invoice) return { error: "Faktúra neexistuje." };
  if (invoice.direction !== "VYDANA") return { error: "E-mailom sa posielajú len vydané doklady." };
  if (invoice.documentStatus !== "ISSUED") return { error: "Doklad musí byť najskôr finalizovaný." };
  if (!invoice.client?.email) return { error: "Klient nemá e-mailovú adresu." };

  // Ak PDF ešte nie je, zaraď jeho vygenerovanie (worker potom reťazovo pošle e-mail).
  if (invoice.documents.length === 0) {
    await enqueueOutbox({
      type: "INVOICE_PDF",
      aggregateType: "Invoice",
      aggregateId: invoiceId,
      idempotencyKey: `invoice:${invoiceId}:manual-pdf:${Date.now()}`,
      payload: { invoiceId },
    });
  } else {
    await enqueueOutbox({
      type: "INVOICE_EMAIL",
      aggregateType: "Invoice",
      aggregateId: invoiceId,
      idempotencyKey: `invoice:${invoiceId}:manual-email:${Date.now()}`,
      payload: { invoiceId },
    });
  }

  const summary = await processPendingOutbox(10);

  revalidatePath(`/financie/faktury/${invoiceId}`);

  if (summary.failed > 0) {
    const failed = await prisma.emailDelivery.findFirst({
      where: { invoiceId, status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      select: { errorMessage: true },
    });
    return { error: failed?.errorMessage ?? "Odoslanie zlyhalo — skúste znova." };
  }
  return { success: "Faktúra bola odoslaná e-mailom klientovi." };
}
