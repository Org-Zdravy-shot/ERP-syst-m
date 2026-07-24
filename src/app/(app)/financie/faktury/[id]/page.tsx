import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import {
  Badge,
  INVOICE_DOCUMENT_STATUS_COLORS,
  INVOICE_PAYMENT_STATUS_COLORS,
} from "@/components/Badge";
import { formatCents, formatDate, formatQty } from "@/lib/format";
import { INVOICE_SOURCE_LABELS } from "@/lib/invoicing";
import {
  financePartySnapshotSchema,
  invoiceDocumentStatusLabels,
  invoicePaymentStatusLabels,
} from "@/lib/zod-schemas";
import { calculatePaymentStatus } from "@/lib/finance/domain";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { cancelInvoice, createCreditNoteFromInvoice, finalizeInvoice } from "../../_actions";
import { InvoiceDocuments } from "./InvoiceDocuments";
import { InvoiceEmails } from "./InvoiceEmails";
import { InvoiceWorkflowActions } from "./InvoiceStatusActions";

export default async function FakturaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: true,
      items: true,
      paymentAllocations: { where: { reversedAt: null } },
      order: { select: { id: true, orderNumber: true } },
      originalInvoice: { select: { id: true, invoiceNumber: true } },
      creditNotes: {
        orderBy: { issueDate: "desc" },
        select: { id: true, invoiceNumber: true, documentStatus: true, totalGrossCents: true },
      },
      documents: {
        where: { archivedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          fileName: true,
          byteSize: true,
          sha256: true,
          createdAt: true,
        },
      },
      emailDeliveries: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          toAddress: true,
          subject: true,
          status: true,
          attemptCount: true,
          sentAt: true,
          errorMessage: true,
          createdAt: true,
        },
      },
    },
  });
  if (!invoice) notFound();

  const session = await getSession();
  const canSendEmail =
    hasFinancePermission(session.role, "CREATE_DRAFT") &&
    invoice.direction === "VYDANA" &&
    invoice.documentStatus === "ISSUED";

  const isIssued = invoice.direction === "VYDANA";
  const isCreditNote = invoice.documentType === "CREDIT_NOTE";
  const snapshotValue = isIssued ? invoice.counterpartySnapshot : invoice.issuerSnapshot;
  const parsedSnapshot = financePartySnapshotSchema.safeParse(snapshotValue);
  const partner = parsedSnapshot.success ? parsedSnapshot.data : null;
  const allocatedCents = invoice.paymentAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
  const paymentStatus = calculatePaymentStatus(invoice.totalGrossCents, allocatedCents);
  const overdue =
    invoice.documentStatus === "ISSUED" &&
    (paymentStatus === "UNPAID" || paymentStatus === "PARTIALLY_PAID") &&
    invoice.dueDate.getTime() < Date.now();
  const counterparty = partner?.name ?? invoice.client?.name ?? invoice.supplierName ?? "—";
  const today = new Date().toISOString().slice(0, 10);
  const in14Days = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const infoRow = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-stone-900">{value ?? "—"}</dd>
    </div>
  );

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={invoice.invoiceNumber ?? (isCreditNote ? "Koncept dobropisu" : "Koncept faktúry")}
          subtitle={`${isCreditNote ? "Dobropis" : isIssued ? "Vydaná faktúra" : "Prijatá faktúra"} · ${INVOICE_SOURCE_LABELS[invoice.source] ?? invoice.source}`}
        >
          <Link
            href="/financie/faktury"
            className="rounded-[10px] border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
          >
            ← Späť na zoznam
          </Link>
        </PageHeader>
      </div>

      <div className="mb-4 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
        Toto je pracovný náhľad ERP. Oficiálnym dokladom je až nemenné PDF vytvorené po finalizácii.
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 print:block">
        <div className="space-y-6 print:space-y-4">
          <section className="rounded-[14px] border border-stone-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-stone-900">Údaje</h2>
              {overdue ? (
                <Badge color="red">Po splatnosti</Badge>
              ) : (
                <Badge color={INVOICE_DOCUMENT_STATUS_COLORS[invoice.documentStatus]}>
                  {invoiceDocumentStatusLabels[invoice.documentStatus] ?? invoice.documentStatus}
                </Badge>
              )}
            </div>
            <div className="mb-3">
              <Badge color={INVOICE_PAYMENT_STATUS_COLORS[paymentStatus]}>
                {invoicePaymentStatusLabels[paymentStatus]}
              </Badge>
            </div>
            <dl className="divide-y divide-stone-100">
              {infoRow(
                isIssued ? "Odberateľ" : "Dodávateľ",
                invoice.client ? (
                  <Link href={`/klienti/${invoice.client.id}`} className="text-stone-950 hover:underline print:no-underline">
                    {counterparty}
                  </Link>
                ) : (
                  counterparty
                ),
              )}
              {(partner?.ico ?? invoice.client?.ico) && infoRow("IČO", partner?.ico ?? invoice.client?.ico)}
              {(partner?.dic ?? invoice.client?.dic) && infoRow("DIČ", partner?.dic ?? invoice.client?.dic)}
              {(partner?.icDph ?? invoice.client?.icDph) &&
                infoRow("IČ DPH", partner?.icDph ?? invoice.client?.icDph)}
              {infoRow("Dátum vystavenia", formatDate(invoice.issueDate))}
              {infoRow("Dátum splatnosti", formatDate(invoice.dueDate))}
              {invoice.deliveryDate && infoRow("Dátum dodania", formatDate(invoice.deliveryDate))}
              {invoice.variableSymbol && infoRow("Variabilný symbol", invoice.variableSymbol)}
              {invoice.externalNumber &&
                infoRow(`Číslo v ${INVOICE_SOURCE_LABELS[invoice.source] ?? invoice.source}`, invoice.externalNumber)}
              {invoice.order &&
                infoRow(
                  "Objednávka",
                  <Link href={`/objednavky/${invoice.order.id}`} className="text-stone-950 hover:underline print:no-underline">
                    {invoice.order.orderNumber}
                  </Link>,
                )}
              {invoice.originalInvoice &&
                infoRow(
                  "Pôvodná faktúra",
                  <Link
                    href={`/financie/faktury/${invoice.originalInvoice.id}`}
                    className="text-stone-950 hover:underline"
                  >
                    {invoice.originalInvoice.invoiceNumber ?? "Koncept"}
                  </Link>,
                )}
            </dl>
            {invoice.note && (
              <p className="mt-3 rounded-[10px] bg-amber-50 px-3 py-2 text-sm text-amber-900 print:hidden">
                {invoice.note}
              </p>
            )}
            {invoice.creditNotes.length > 0 && (
              <div className="mt-3 border-t border-stone-100 pt-3">
                <p className="mb-2 text-xs font-semibold uppercase text-stone-500">Dobropisy</p>
                <ul className="space-y-1 text-sm">
                  {invoice.creditNotes.map((creditNote) => (
                    <li key={creditNote.id} className="flex justify-between gap-3">
                      <Link href={`/financie/faktury/${creditNote.id}`} className="hover:underline">
                        {creditNote.invoiceNumber ?? "Koncept dobropisu"}
                      </Link>
                      <span className="text-stone-500">{formatCents(creditNote.totalGrossCents)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <InvoiceDocuments
            invoiceId={invoice.id}
            canGenerate={
              invoice.direction === "VYDANA" &&
              invoice.documentStatus === "ISSUED" &&
              Boolean(
                invoice.invoiceNumber &&
                  invoice.finalizedAt &&
                  invoice.issuerSnapshot &&
                  invoice.counterpartySnapshot &&
                  invoice.taxSnapshot,
              )
            }
            documents={invoice.documents.map((document) => ({
              ...document,
              createdAt: document.createdAt.toISOString(),
            }))}
          />

          {invoice.direction === "VYDANA" && (
            <InvoiceEmails
              invoiceId={invoice.id}
              canSend={canSendEmail}
              deliveries={invoice.emailDeliveries.map((delivery) => ({
                ...delivery,
                sentAt: delivery.sentAt ? delivery.sentAt.toISOString() : null,
                createdAt: delivery.createdAt.toISOString(),
              }))}
            />
          )}

          {invoice.documentStatus !== "CANCELLED" && (
            <section className="rounded-[14px] border border-stone-200 bg-white p-5 print:hidden">
              <h2 className="mb-3 font-semibold text-stone-900">Akcie</h2>
              <InvoiceWorkflowActions
                documentStatus={invoice.documentStatus}
                documentType={invoice.documentType}
                defaultIssueDate={today}
                defaultDueDate={in14Days}
                finalizeAction={finalizeInvoice.bind(null, invoice.id)}
                cancelAction={cancelInvoice.bind(null, invoice.id)}
                creditNoteAction={createCreditNoteFromInvoice.bind(null, invoice.id)}
              />
            </section>
          )}
        </div>

        <div className="lg:col-span-2 print:mt-4">
          <section className="rounded-[14px] border border-stone-200 bg-white">
            <h2 className="border-b border-stone-100 px-5 py-3 font-semibold text-stone-900">Položky</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
                  <th className="px-5 py-2">Popis</th>
                  <th className="px-5 py-2 text-right">Množstvo</th>
                  <th className="px-5 py-2 text-right">Cena/j. bez DPH</th>
                  <th className="px-5 py-2 text-right">DPH %</th>
                  <th className="px-5 py-2 text-right">Spolu bez DPH</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => (
                  <tr key={item.id} className="border-b border-stone-50 last:border-0">
                    <td className="px-5 py-2.5 font-medium text-stone-900">{item.description}</td>
                    <td className="px-5 py-2.5 text-right text-stone-600">
                      {formatQty(item.quantity, item.unit)}
                    </td>
                    <td className="px-5 py-2.5 text-right text-stone-600">{formatCents(item.unitPriceCents)}</td>
                    <td className="px-5 py-2.5 text-right text-stone-600">{item.vatRate} %</td>
                    <td className="px-5 py-2.5 text-right font-medium text-stone-900">
                      {formatCents(item.totalNetCents ?? Math.round(item.quantity * item.unitPriceCents))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-stone-200 text-sm">
                  <td colSpan={4} className="px-5 py-2 text-right text-stone-500">
                    Spolu bez DPH
                  </td>
                  <td className="px-5 py-2 text-right font-medium text-stone-900">
                    {formatCents(invoice.totalNetCents)}
                  </td>
                </tr>
                <tr className="text-sm">
                  <td colSpan={4} className="px-5 py-1 text-right text-stone-500">
                    DPH
                  </td>
                  <td className="px-5 py-1 text-right font-medium text-stone-900">
                    {formatCents(invoice.totalVatCents)}
                  </td>
                </tr>
                <tr className="text-sm">
                  <td colSpan={4} className="px-5 py-2 text-right font-semibold text-stone-900">
                    Spolu s DPH
                  </td>
                  <td className="px-5 py-2 text-right text-base font-bold text-stone-950">
                    {formatCents(invoice.totalGrossCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
        </div>
      </div>
    </>
  );
}
