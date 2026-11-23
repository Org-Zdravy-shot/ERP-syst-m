"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { issueQuote, setQuoteDecision, quoteDecision, quoteInputSchema, convertQuoteToOrder } from "@/lib/finance/quotes/service";
import { invoiceService } from "@/lib/finance/invoice-service";
import type { DeliveryFormState } from "../dodacie-listy/_actions";

const base = "/financie/cenove-ponuky";
const field = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

function errorText(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0].message;
  if (error instanceof Error && !("clientVersion" in error)) return error.message;
  return "Zmenu sa nepodarilo uložiť. Obnovte stránku a skúste to znova.";
}

export async function issueQuoteAction(_prev: DeliveryFormState, data: FormData): Promise<DeliveryFormState> {
  const actor = await requireFinancePermission("CREATE_DRAFT");
  let quote;
  try {
    quote = await issueQuote(quoteInputSchema.parse({
      submissionKey: field(data, "submissionKey"), legalEntity: field(data, "legalEntity"),
      clientId: field(data, "clientId"), issueDate: field(data, "issueDate"), validUntil: field(data, "validUntil"),
      lines: JSON.parse(field(data, "lines") || "[]"), note: field(data, "note") || undefined,
    }), actor.userId);
  } catch (error) { return { error: errorText(error) }; }
  revalidatePath(base);
  redirect(`${base}/${quote.id}`);
}

export async function quoteDecisionAction(id: string, _prev: DeliveryFormState, data: FormData): Promise<DeliveryFormState> {
  const actor = await requireFinancePermission("CREATE_DRAFT");
  try {
    await setQuoteDecision(id, quoteDecision.parse(field(data, "decision")), actor.userId);
  } catch (error) { return { error: errorText(error) }; }
  revalidatePath(base);
  redirect(`${base}/${id}`);
}

export async function quoteToInvoiceAction(id: string, _prev: DeliveryFormState, data: FormData): Promise<DeliveryFormState> {
  const actor = await requireFinancePermission("CREATE_DRAFT");
  let invoice;
  try {
    const dates = z.object({ issueDate: z.iso.date(), deliveryDate: z.iso.date(), dueDate: z.iso.date() }).parse({
      issueDate: field(data, "issueDate"), deliveryDate: field(data, "deliveryDate"), dueDate: field(data, "dueDate"),
    });
    invoice = await invoiceService.createDraft({
      direction: "VYDANA", currency: "EUR", items: [], quoteId: id, actorId: actor.userId,
      issueDate: new Date(dates.issueDate), deliveryDate: new Date(dates.deliveryDate), dueDate: new Date(dates.dueDate),
    });
  } catch (error) { return { error: errorText(error) }; }
  revalidatePath(`${base}/${id}`);
  revalidatePath("/financie/faktury");
  redirect(`/financie/faktury/${invoice.id}`);
}

export async function quoteToOrderAction(id: string, _prev: DeliveryFormState, data: FormData): Promise<DeliveryFormState> {
  const actor = await requireFinancePermission("CREATE_DRAFT");
  let order;
  try {
    const date = z.iso.date().parse(field(data, "orderDate"));
    order = await convertQuoteToOrder(id, new Date(date), actor.userId);
  } catch (error) { return { error: errorText(error) }; }
  revalidatePath(`${base}/${id}`);
  revalidatePath("/objednavky");
  redirect(`/objednavky/${order.id}`);
}
