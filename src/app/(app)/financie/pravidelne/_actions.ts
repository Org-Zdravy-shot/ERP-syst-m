"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { createRecurringSchedule, generateNextRecurringDraft, setRecurringPaused, todaySlovakia } from "@/lib/finance/recurring/schedule";
import type { DeliveryFormState } from "../dodacie-listy/_actions";

const page = "/financie/pravidelne";
const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
function errorText(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0].message;
  return error instanceof Error && !("clientVersion" in error) ? error.message : "Plán sa nepodarilo uložiť.";
}

export async function createRecurringAction(_prev: DeliveryFormState, data: FormData): Promise<DeliveryFormState> {
  const actor = await requireFinancePermission("CREATE_DRAFT");
  try {
    await createRecurringSchedule({
      submissionKey: text(data, "submissionKey"), sourceInvoiceId: text(data, "sourceInvoiceId"),
      title: text(data, "title"), startDate: text(data, "startDate"),
      intervalMonths: Number(text(data, "intervalMonths")), dueDays: Number(text(data, "dueDays")),
      maxCount: text(data, "maxCount") ? Number(text(data, "maxCount")) : undefined,
    }, actor.userId);
  } catch (error) { return { error: errorText(error) }; }
  revalidatePath(page);
  redirect(page);
}

export async function pauseRecurringAction(id: string, paused: boolean, _prev: DeliveryFormState): Promise<DeliveryFormState> {
  const actor = await requireFinancePermission("CREATE_DRAFT");
  try {
    await setRecurringPaused(id, paused, actor.userId);
  } catch (error) { return { error: errorText(error) }; }
  revalidatePath(page);
  redirect(page);
}

export async function generateRecurringAction(id: string, date: string, _prev: DeliveryFormState): Promise<DeliveryFormState> {
  await requireFinancePermission("CREATE_DRAFT");
  let invoice;
  try {
    const expected = z.iso.date().parse(date);
    invoice = await generateNextRecurringDraft(id, todaySlovakia(), new Date(expected));
    if (!invoice) return { error: "Tento termín už bol spracovaný alebo plán zatiaľ nemá splatný termín." };
  } catch (error) { return { error: errorText(error) }; }
  revalidatePath(page);
  revalidatePath("/financie/faktury");
  redirect(`/financie/faktury/${invoice.id}`);
}
