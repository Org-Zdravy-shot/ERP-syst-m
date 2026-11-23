import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary, btnSecondary, table, thead, tr } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { formatUnitPrice } from "@/lib/precise-price";
import { deliveryLinesSchema } from "@/lib/finance/delivery/schema";
import { hasFinancePermission, requireFinancePermission } from "@/lib/finance/permissions";
import { prisma } from "@/lib/prisma";
import { financePartySnapshotSchema } from "@/lib/zod-schemas";
import { CancelDeliveryNote } from "./CancelDeliveryNote";

export default async function DeliveryNoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireFinancePermission("VIEW");
  const { id } = await params;
  const base = `/financie/dodacie-listy/${id}`;
  const note = await prisma.deliveryNote.findUnique({
    where: { id }, include: { quote: { select: { id: true, number: true } }, invoiceLinks: {
      include: { invoice: { select: { id: true, invoiceNumber: true, documentStatus: true, finalizedAt: true } } },
    } },
  });
  if (!note) notFound();
  const parties = [
    { label: "Dodávateľ", data: financePartySnapshotSchema.parse(note.issuerSnapshot) },
    { label: "Odberateľ", data: financePartySnapshotSchema.parse(note.counterpartySnapshot) },
  ];
  const lines = deliveryLinesSchema.parse(note.lines);
  const linked = note.invoiceLinks.map(link => link.invoice);
  const reserved = linked.some(invoice => invoice.documentStatus !== "CANCELLED" || !!invoice.finalizedAt);
  return <>
    <PageHeader title={`Dodací list ${note.number}`} subtitle={note.cancelledAt ? "Zrušený" : reserved ? "Súvisiaca faktúra v evidencii" : "Na fakturáciu"}>
      <Link className={btnSecondary} href="/financie/dodacie-listy">Späť na zoznam</Link>
    </PageHeader>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
      <article className="finance-document">
        <div className="finance-document-title"><h2>{note.number}</h2><span>{formatDate(note.deliveryDate)}</span></div>
        <div className="finance-parties">
          {parties.map(({ label, data }) => <section key={label}>
            <h3>{label}</h3><strong>{data.name}</strong><p>{data.street}</p><p>{[data.zip, data.city].filter(Boolean).join(" ")}</p>
            {data.ico && <p>IČO {data.ico}</p>}
          </section>)}
        </div>
        <div className="finance-editor-section grid gap-3 sm:grid-cols-2">
          <div><div className="text-xs text-stone-500">Vystavenie</div>{formatDate(note.issueDate)}</div>
          <div><div className="text-xs text-stone-500">Dodanie</div>{formatDate(note.deliveryDate)}</div>
          {note.deliveryAddress && <div><div className="text-xs text-stone-500">Adresa dodania</div>{note.deliveryAddress}</div>}
          {note.orderId && <div><div className="text-xs text-stone-500">Naša objednávka</div><Link className="underline" href={`/objednavky/${note.orderId}`}>{note.supplierOrderNumber}</Link></div>}
          {note.buyerOrderNumber && <div><div className="text-xs text-stone-500">Objednávka odberateľa</div>{note.buyerOrderNumber}</div>}
          {note.quote && <div><div className="text-xs text-stone-500">Cenová ponuka</div><Link className="underline" href={`/financie/cenove-ponuky/${note.quote.id}`}>{note.quote.number}</Link></div>}
        </div>
        <section className="finance-editor-section">
          <h3>Položky dodania</h3>
          <div className="overflow-x-auto"><table className={table}>
            <thead className={thead}><tr><th className="px-3 py-2" scope="col">Položka</th><th className="px-3 py-2" scope="col">Množstvo</th><th className="px-3 py-2" scope="col">Cena za jednotku bez DPH</th></tr></thead>
            <tbody>{lines.filter(line => line.kind === "GOODS").map((line, index) => <tr key={index} className={tr}>
              <td className="px-3 py-2"><strong>{line.description}</strong>{line.productSku && <div className="text-xs text-stone-500">{line.productSku}</div>}</td>
              <td className="px-3 py-2 whitespace-nowrap">{line.quantity} {line.unit}</td>
              <td className="px-3 py-2">{line.unitPriceExact ? `${formatUnitPrice(line.unitPriceExact)} €` : "—"}</td>
            </tr>)}</tbody>
          </table></div>
        </section>
        {note.note && <section className="finance-editor-section"><h3>Poznámka</h3><p className="whitespace-pre-wrap">{note.note}</p></section>}
      </article>
      <aside className="space-y-4">
        <div className="finance-editor-sidebar space-y-3">
          <h3>Akcie</h3>
          {!reserved && !note.cancelledAt && hasFinancePermission(actor.role, "CREATE_DRAFT") && <Link href={`/financie/dodacie-listy/fakturovat?dl=${id}`} className={btnPrimary}>Vytvoriť faktúru</Link>}
          <Link href={`${base}/pdf`} className={btnSecondary}>Stiahnuť PDF</Link>
          {lines.some(line => line.kind === "GOODS" && line.unitPriceExact) && <Link href={`${base}/pdf?ceny=1`} className={btnSecondary}>Stiahnuť PDF s cenami</Link>}
          {linked.length > 0 && <section className="space-y-1 pt-3"><h3>Súvisiace faktúry</h3>
            {linked.map(invoice => <Link key={invoice.id} href={`/financie/faktury/${invoice.id}`} className="block text-sm underline">
              {invoice.documentStatus === "CANCELLED" ? "Zrušený " : ""}{invoice.invoiceNumber ?? "koncept faktúry"}
            </Link>)}
          </section>}
        </div>
        {!reserved && !note.cancelledAt && hasFinancePermission(actor.role, "CANCEL") && <CancelDeliveryNote id={id} />}
      </aside>
    </div>
  </>;
}
