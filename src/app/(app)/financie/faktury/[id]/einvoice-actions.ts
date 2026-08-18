"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getOutgoingEInvoiceValidationService } from "@/lib/finance/einvoice/composition";
import { requireFinancePermission } from "@/lib/finance/permissions";

export interface EInvoiceActionState {
  error?: string;
  success?: string;
}

export async function validateEInvoiceNow(
  invoiceId: string,
  _previous: EInvoiceActionState,
  _formData: FormData,
): Promise<EInvoiceActionState> {
  const user = await requireFinancePermission("SEND_DOCUMENT");
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { direction: true, documentStatus: true },
  });
  if (!invoice) return { error: "Faktúra neexistuje." };
  if (invoice.direction !== "VYDANA") {
    return { error: "eFaktúru možno pripraviť iba z vydaného dokladu." };
  }
  if (invoice.documentStatus !== "ISSUED") {
    return { error: "Doklad musí byť najskôr finalizovaný." };
  }

  try {
    const result = await getOutgoingEInvoiceValidationService().prepareAndValidate(
      invoiceId,
      user.userId,
    );
    revalidatePath(`/financie/faktury/${invoiceId}`);
    if (result.status === "VALIDATED") {
      const recipient = result.lookupUnavailable
        ? " Dostupnosť príjemcu sa pre výpadok siete nepodarilo potvrdiť."
        : result.recipientFound
          ? " Príjemca je dostupný v testovacej sieti."
          : " Príjemca zatiaľ nebol v testovacej sieti nájdený.";
      return {
        success: `${result.reused ? "Existujúce" : "Nové"} UBL prešlo sandbox validáciou.${recipient}`,
      };
    }
    if (result.status === "REJECTED") {
      return {
        error:
          "UBL bolo bezpečne uložené, ale neprešlo validáciou. Detail je v stave prenosu.",
      };
    }
    return { success: `Prenos má stav ${result.status}.` };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "eFaktúru sa nepodarilo pripraviť a overiť.",
    };
  }
}
