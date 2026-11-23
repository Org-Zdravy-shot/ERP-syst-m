import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary, table, thead, tr } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { requireFinancePermission, hasFinancePermission } from "@/lib/finance/permissions";
import { deliveryLinesSchema } from "@/lib/finance/delivery/schema";
import { financePartySnapshotSchema } from "@/lib/zod-schemas";
import { formatCents, formatDate } from "@/lib/format";
import { formatUnitPrice } from "@/lib/precise-price";
import { slovakDateKey } from "../../../objednavky/pricing";
import { QuoteActions } from "./QuoteActions";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireFinancePermission("VIEW");
  const { id } = await params;
  const quote = await prisma.salesQuote.findUnique({ where: { id }, include: {
    order: { select: { id: true, orderNumber: true } },
    deliveryNotes: { select: { id: true, number: true, cancelledAt: true } },
    invoices: { select: { id: true, invoiceNumber: true, documentStatus: true, finalizedAt: true } },
  } });
  if (!quote) notFound();
  const lines = deliveryLinesSchema.parse(quote.lines);
  const parties = [financePartySnapshotSchema.parse(quote.issuerSnapshot), financePartySnapshotSchema.parse(quote.counterpartySnapshot)];
  const hasDocument = !!quote.order || quote.deliveryNotes.some(note => !note.cancelledAt) || quote.invoices.some(invoice => invoice.documentStatus !== "CANCELLED" || !!invoice.finalizedAt);
  const today = slovakDateKey();
  const issueDate = quote.issueDate.toISOString().slice(0,10);
  const status = quote.status === "ACCEPTED" ? "Schválená" : quote.status === "REJECTED" ? "Zamietnutá" : quote.validUntil.toISOString().slice(0,10) < today ? "Expirovaná" : "Čaká na schválenie";
  return <>
    <PageHeader title={`Cenová ponuka ${quote.number}`} subtitle={status}><Link href="/financie/cenove-ponuky" className={btnSecondary}>Späť na zoznam</Link></PageHeader>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
      <article className="finance-document">
        <div className="finance-document-title"><h2>{quote.number}</h2><span>EUR</span></div>
        <div className="finance-parties">{parties.map((party, index) => <section key={index}>
          <h3>{index === 0 ? "Dodávateľ" : "Odberateľ"}</h3><strong>{party.name}</strong>
          <p>{party.street}</p><p>{party.zip} {party.city}</p>{party.ico && <p>IČO {party.ico}</p>}
        </section>)}</div>
        <div className="finance-editor-section flex flex-wrap gap-6 text-sm">
          <div><p className="text-stone-500">Vystavenie</p>{formatDate(quote.issueDate)}</div>
          <div><p className="text-stone-500">Platnosť do</p>{formatDate(quote.validUntil)}</div>
        </div>
        <section className="finance-editor-section">
          <h3>Položky</h3>
          <div className="overflow-x-auto"><table className={table}>
            <thead className={thead}><tr>{["Položka","Množstvo","Cena za jednotku bez DPH","DPH"].map(label => <th className="px-3 py-2" scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>{lines.map((line, index) => <tr key={index} className={tr}>
              <td className="px-3 py-2">{line.description}</td><td className="px-3 py-2">{line.quantity} {line.unit}</td>
              <td className="px-3 py-2">{formatUnitPrice(line.unitPriceExact!)} €</td><td className="px-3 py-2">{line.vatRate ?? 0} %</td>
            </tr>)}</tbody>
          </table></div>
        </section>
        <dl className="finance-editor-section space-y-1 text-sm">
          <div className="flex justify-between"><dt>Základ</dt><dd>{formatCents(quote.totalNetCents)}</dd></div>
          <div className="flex justify-between"><dt>DPH</dt><dd>{formatCents(quote.totalVatCents)}</dd></div>
          <div className="flex justify-between font-semibold"><dt>Celkom</dt><dd>{formatCents(quote.totalGrossCents)}</dd></div>
        </dl>
        {quote.note && <div className="finance-editor-section whitespace-pre-wrap">{quote.note}</div>}
      </article>
      <aside className="finance-editor-sidebar space-y-4">
        <h3>Akcie</h3>
        <Link className={btnSecondary} href={`/financie/cenove-ponuky/${id}/pdf`}>Stiahnuť PDF</Link>
        {hasFinancePermission(actor.role, "CREATE_DRAFT") && <QuoteActions id={id} status={quote.status} hasDocument={hasDocument}
          canMakeOrder={lines.every(line => !!line.productId && Number.isInteger(line.quantity))} startDate={today < issueDate ? issueDate : today} />}
        {(quote.order || quote.deliveryNotes.length > 0 || quote.invoices.length > 0) && <div className="space-y-2 border-t border-stone-200 pt-3">
          <h3>Nadväzné doklady</h3>
          {quote.order && <Link className="block underline" href={`/objednavky/${quote.order.id}`}>{quote.order.orderNumber}</Link>}
          {quote.deliveryNotes.map(note => <Link key={note.id} className="block underline" href={`/financie/dodacie-listy/${note.id}`}>{note.number}{note.cancelledAt ? " · zrušený" : ""}</Link>)}
          {quote.invoices.map(invoice => <Link key={invoice.id} className="block underline" href={`/financie/faktury/${invoice.id}`}>{invoice.invoiceNumber ?? "Koncept faktúry"}{invoice.documentStatus === "CANCELLED" ? " · zrušený" : ""}</Link>)}
        </div>}
      </aside>
    </div>
  </>;
}
