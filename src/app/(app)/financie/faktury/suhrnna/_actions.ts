"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { invoiceService } from "@/lib/finance/invoice-service";
import { consolidationSchema } from "@/lib/finance/consolidation";
import { fmcgPropertySchema } from "@/lib/finance/einvoice/fmcg";

const date = fmcgPropertySchema.shape.delivery_date.unwrap();
const schema = z.object({
  issueDate: date, dueDate: date,
  buyerReference: z.string().trim().min(1, "Vyplňte referenciu odberateľa.").max(140),
  note: z.string().trim().max(2000),
  orders: consolidationSchema,
});
export async function createConsolidatedInvoice(_previous: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const user = await requireFinancePermission("CREATE_DRAFT");
  let id: string;
  let orderIds: string[];
  try {
    const raw = String(formData.get("orders") ?? "");
    if (raw.length > 100_000) throw new Error("Výber objednávok je príliš veľký.");
    let orders: unknown;
    try { orders = JSON.parse(raw); } catch { throw new Error("Výber objednávok je neplatný. Obnovte formulár."); }
    const result = schema.safeParse({ issueDate: formData.get("issueDate"), dueDate: formData.get("dueDate"), buyerReference: formData.get("buyerReference"), note: formData.get("note") ?? "", orders });
    if (!result.success) {
      const fields: Record<string, string> = { issueDate: "Dátum vystavenia", dueDate: "Splatnosť", buyerReference: "Referencia odberateľa", note: "Poznámka", orders: "Objednávky", deliveryDate: "Dátum dodania", buyerOrderNumber: "Číslo objednávky odberateľa", deliveryNoteNumber: "Číslo dodacieho listu", expectedUpdatedAt: "Verzia objednávky", orderId: "Objednávka" };
      return { error: result.error.issues.map(i => `${i.path[0] === "orders" && typeof i.path[1] === "number" ? `Vybraná objednávka ${i.path[1] + 1}, ` : ""}${fields[String(i.path.at(-1))] ?? "Výber objednávok"}: ${i.message}`).join(" ") };
    }
    const input = result.data;
    const created = await invoiceService.createDraft({
      direction: "VYDANA", source: "INTERNA", currency: "EUR", actorId: user.userId,
      issueDate: new Date(input.issueDate), dueDate: new Date(input.dueDate), buyerReference: input.buyerReference,
      note: input.note || undefined, consolidation: input.orders, items: [],
    });
    id = created.id; orderIds = input.orders.map(o => o.orderId);
  } catch (error) { return { error: error instanceof Error ? error.message : "Súhrnný koncept sa nepodarilo uložiť." }; }
  revalidatePath("/financie/faktury"); revalidatePath("/financie");
  revalidatePath("/financie/faktury/suhrnna");
  for (const orderId of orderIds) revalidatePath(`/objednavky/${orderId}`);
  redirect(`/financie/faktury/${id}`);
}
