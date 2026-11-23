"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { cancelDeliveryNote, issueDeliveryNote } from "@/lib/finance/delivery/service";
import { invoiceDeliveryNotesSchema, issueDeliveryNoteSchema } from "@/lib/finance/delivery/schema";
import { invoiceService } from "@/lib/finance/invoice-service";

export interface DeliveryFormState { error?: string }

function text(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

function message(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const index = issue.path[1];
    if (issue.path[0] === "lines" && typeof index === "number") return `Položka ${index + 1}: ${issue.message}`;
    return issue.message;
  }
  if (error instanceof Error && "clientVersion" in error) return "Doklad sa nepodarilo uložiť. Obnovte stránku a skúste znova.";
  return error instanceof Error ? error.message : "Doklad sa nepodarilo uložiť.";
}

export async function issueDeliveryNoteAction(_previous: DeliveryFormState, data: FormData): Promise<DeliveryFormState> {
  const actor = await requireFinancePermission("CREATE_DRAFT");
  const orderId = text(data, "orderId") || undefined;
  let result;
  try {
    const input = issueDeliveryNoteSchema.parse({
      submissionKey: text(data, "submissionKey"), orderId,
      expectedOrderUpdatedAt: text(data, "expectedOrderUpdatedAt") || undefined,
      legalEntity: text(data, "legalEntity") || undefined, clientId: text(data, "clientId") || undefined,
      issueDate: text(data, "issueDate"), deliveryDate: text(data, "deliveryDate"),
      buyerOrderNumber: text(data, "buyerOrderNumber") || undefined,
      deliveryAddress: text(data, "deliveryAddress") || undefined, note: text(data, "note") || undefined,
      lines: orderId ? undefined : JSON.parse(text(data, "lines") || "[]"),
    });
    result = await issueDeliveryNote(input, actor.userId);
  } catch (error) {
    return { error: message(error) };
  }
  revalidatePath("/financie/dodacie-listy");
  if (result.orderId) revalidatePath(`/objednavky/${result.orderId}`);
  redirect(`/financie/dodacie-listy/${result.id}`);
}

export async function createDeliveryInvoiceAction(_previous: DeliveryFormState, data: FormData): Promise<DeliveryFormState> {
  const actor = await requireFinancePermission("CREATE_DRAFT");
  let invoice;
  try {
    const dates = z.object({ issue: z.iso.date(), due: z.iso.date() }).parse({
      issue: text(data, "issueDate"), due: text(data, "dueDate"),
    });
    const missingPrices = [...data.entries()].flatMap(([key, value]) => {
      const match = /^price:([a-z0-9]+):(\d+)$/.exec(key);
      return match ? [{ noteId: match[1], index: Number(match[2]), price: String(value) }] : [];
    });
    const deliveryNotes = invoiceDeliveryNotesSchema.parse({ ids: data.getAll("dl"), missingPrices });
    const memo = z.string().max(1000).parse(text(data, "note"));
    invoice = await invoiceService.createDraft({
      direction: "VYDANA", currency: "EUR", issueDate: new Date(dates.issue), dueDate: new Date(dates.due),
      buyerReference: text(data, "buyerReference") || undefined, note: memo || undefined, items: [],
      deliveryNotes, actorId: actor.userId,
    });
  } catch (error) {
    return { error: message(error) };
  }
  revalidatePath("/financie/dodacie-listy");
  revalidatePath("/financie/faktury");
  redirect(`/financie/faktury/${invoice.id}`);
}

export async function cancelDeliveryNoteAction(noteId: string, _previous: DeliveryFormState, data: FormData): Promise<DeliveryFormState> {
  const actor = await requireFinancePermission("CANCEL");
  try {
    await cancelDeliveryNote(noteId, text(data, "reason"), actor.userId);
  } catch (error) {
    return { error: message(error) };
  }
  revalidatePath("/financie/dodacie-listy");
  redirect(`/financie/dodacie-listy/${noteId}`);
}
