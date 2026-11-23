import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary, errorBox } from "@/components/ui";
import { deliveryLinesSchema, deliveryNoteIdsSchema, invoiceKeepsDelivery } from "@/lib/finance/delivery/schema";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { prisma } from "@/lib/prisma";
import { slovakDateKey } from "../../../objednavky/pricing";
import { DeliveryInvoiceForm } from "./DeliveryInvoiceForm";

export default async function CreateDeliveryInvoicePage({ searchParams }: { searchParams: Promise<{ dl?: string | string[] }> }) {
  await requireFinancePermission("CREATE_DRAFT");
  const { dl } = await searchParams;
  const parsed = deliveryNoteIdsSchema.safeParse(typeof dl === "string" ? [dl] : dl ?? []);
  const ids = parsed.success ? [...new Set(parsed.data)] : [];
  const notes = ids.length ? await prisma.deliveryNote.findMany({
    where: { id: { in: ids } }, orderBy: [{ deliveryDate: "asc" }, { number: "asc" }],
    select: { id: true, number: true, legalEntity: true, clientId: true, deliveryDate: true, lines: true, cancelledAt: true, buyerOrderNumber: true,
      invoiceLinks: { where: { invoice: { OR: [...invoiceKeepsDelivery.OR] } }, take: 1, select: { invoiceId: true } },
    },
  }) : [];
  const first = notes[0], last = notes.at(-1);
  let error = "";
  if (!parsed.success) error = parsed.error.issues[0].message;
  else if (!first || !last || notes.length !== ids.length || ids.length !== parsed.data.length) error = "Výber obsahuje neplatný alebo opakovaný dodací list.";
  else if (notes.some(note => note.cancelledAt || note.invoiceLinks.length)) error = "Niektorý z dodacích listov je zrušený alebo už má faktúru.";
  else if (notes.some(note => note.legalEntity !== first.legalEntity || note.clientId !== first.clientId)) error = "Vyberte dodacie listy rovnakého odberateľa a dodávateľa.";
  else if (first.deliveryDate.toISOString().slice(0, 7) !== last.deliveryDate.toISOString().slice(0, 7)) error = "Dodacie listy musia patriť do jedného kalendárneho mesiaca.";
  const today = slovakDateKey();
  const deliveryDate = last?.deliveryDate.toISOString().slice(0, 10) ?? today;
  const issueDate = today >= deliveryDate ? today : deliveryDate;
  const dueDate = new Date(new Date(issueDate).getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  const reference = first?.buyerOrderNumber;
  const buyerReference = reference && notes.every(note => note.buyerOrderNumber === reference) ? reference : "";
  return <>
    <PageHeader title="Faktúra z dodacích listov">
      <Link href="/financie/dodacie-listy" className={btnSecondary}>Späť na dodacie listy</Link>
    </PageHeader>
    {error ? <p className={errorBox} role="alert">{error}</p> : <DeliveryInvoiceForm notes={notes.map(note => ({
      id: note.id, number: note.number, lines: deliveryLinesSchema.parse(note.lines),
    }))} issueDate={issueDate} dueDate={dueDate} buyerReference={buyerReference} />}
  </>;
}
