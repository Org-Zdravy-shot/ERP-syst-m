import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { PageHeader } from "@/components/PageHeader";
import { Badge, ORDER_STATUS_COLORS, INVOICE_DOCUMENT_STATUS_COLORS } from "@/components/Badge";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";
import { computeTotals } from "@/lib/invoicing";
import { invoiceDocumentStatusLabels, orderStatusLabels, orderChannelLabels } from "@/lib/zod-schemas";
import { ORDER_STATUS_TRANSITIONS, EDITABLE_ORDER_STATUSES, SUBSCRIPTION_FREQUENCY_LABELS } from "../konstanty";
import { setOrderStatus } from "../_actions";
import { issueInvoiceFromOrder } from "../../financie/_actions";
import { StatusActions } from "./StatusActions";
import { IssueInvoiceButton } from "./IssueInvoiceButton";
import { DraftCleanup } from "./DraftCleanup";
import { formatUnitPrice, lineNetCents } from "@/lib/precise-price";

export default async function ObjednavkaDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ulozene?: string }> }) {
  const { id } = await params;
  const { ulozene } = await searchParams;
  const session = await getSession();
  const canViewFinance = hasFinancePermission(session.role, "VIEW");

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      client: true,
      items: { include: { product: true } },
      charges: true,
      invoices: true,
      subscription: true,
      inboxMessage: true,
      movements: { include: { product: true, batch: { select: { batchNumber: true, expiryDate: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) notFound();

  const totals = computeTotals([...order.items, ...order.charges.map((charge) => ({ quantity: 1, ...charge }))]);
  const allowedStatuses = ORDER_STATUS_TRANSITIONS[order.status] ?? [];
  const isEditable = EDITABLE_ORDER_STATUSES.includes(order.status);

  const infoRow = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-stone-900">{value ?? "—"}</dd>
    </div>
  );

  return (
    <>
      {ulozene === "1" && <><DraftCleanup orderId={order.id} submissionKey={order.submissionKey} /><p role="status" className="mb-4 rounded-[10px] bg-green-50 px-4 py-3 text-sm text-green-900">Objednávka {order.orderNumber} je uložená.</p></>}
      <PageHeader title={order.orderNumber} subtitle={`Objednávka · ${orderChannelLabels[order.channel] ?? order.channel}`}>
        {isEditable && (
          <Link
            href={`/objednavky/${order.id}/upravit`}
            className="rounded-[10px] border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
          >
            Upraviť
          </Link>
        )}
        <Link
          href="/objednavky"
          className="rounded-[10px] border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
        >
          ← Späť na zoznam
        </Link>
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <section className="rounded-[14px] border border-stone-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-stone-900">Údaje</h2>
              <Badge color={ORDER_STATUS_COLORS[order.status]}>{orderStatusLabels[order.status] ?? order.status}</Badge>
            </div>
            <dl className="divide-y divide-stone-100">
              {infoRow(
                "Klient",
                <Link href={`/klienti/${order.clientId}`} className="text-stone-950 hover:underline">
                  {order.client.name}
                </Link>,
              )}
              {infoRow("Dátum objednávky", formatDate(order.orderDate))}
              {infoRow("Dátum dodania", formatDate(order.deliveryDate))}
              {infoRow("Najneskorší termín", formatDate(order.latestDeliveryDate))}
              {infoRow("Dodacia adresa", [order.deliveryStreet, order.deliveryZip, order.deliveryCity, order.deliveryCountry].filter(Boolean).join(", ") || "Fakturačná adresa")}
              {infoRow("Kontakt pri dodaní", order.deliveryContact ?? "—")}
              {infoRow("Úhrada", ({ UNKNOWN: "Nezaznamenané", UNAGREED: "Nedohodnuté", INVOICE: "Faktúra", CARD_ON_DELIVERY: "Karta pri dodaní", BANK_TRANSFER: "Bankový prevod", CASH: "Hotovosť" } as Record<string, string>)[order.paymentMethod] ?? order.paymentMethod)}
              {infoRow("Splatnosť faktúry", order.paymentTermDays == null ? "Predvolene 14 dní" : `${order.paymentTermDays} dní`)}
              {order.externalId && infoRow("Externé ID", order.externalId)}
              {order.subscription &&
                infoRow(
                  "Predplatné",
                  <Link href="/objednavky/predplatne" className="text-stone-950 hover:underline">
                    {SUBSCRIPTION_FREQUENCY_LABELS[order.subscription.frequency] ?? order.subscription.frequency}
                  </Link>,
                )}
              {order.inboxMessage &&
                infoRow(
                  "Zdroj",
                  <Link href={`/objednavky/inbox/${order.inboxMessage.id}`} className="text-stone-950 hover:underline">
                    Správa z inboxu
                  </Link>,
                )}
            </dl>
            {order.note && <p className="mt-3 rounded-[10px] bg-amber-50 px-3 py-2 text-sm text-amber-900">{order.note}</p>}
          </section>

          <section className="rounded-[14px] border border-stone-200 bg-white p-5">
            <h2 className="mb-3 font-semibold text-stone-900">Zmena stavu</h2>
            {allowedStatuses.length === 0 ? (
              <p className="text-sm text-stone-400">Objednávka je uzavretá.</p>
            ) : (
              <StatusActions allowedStatuses={allowedStatuses} action={setOrderStatus.bind(null, order.id)} />
            )}
            {allowedStatuses.includes("EXPEDOVANA") && (
              <p className="mt-3 text-xs text-stone-400">
                Expedícia odpíše produkty zo skladu (pohyby PREDAJ). Pri nedostatku zásob sa neuskutoční.
              </p>
            )}
          </section>

          {canViewFinance && <section className="rounded-[14px] border border-stone-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-stone-900">Faktúry</h2>
              {order.status !== "ZRUSENA" &&
                !order.invoices.some(
                  (i) =>
                    i.direction === "VYDANA" &&
                    i.documentType === "INVOICE" &&
                    i.documentStatus !== "CANCELLED",
                ) && (
                  <IssueInvoiceButton action={issueInvoiceFromOrder.bind(null, order.id)} />
                )}
            </div>
            {order.invoices.length === 0 ? (
              <p className="text-sm text-stone-400">Zatiaľ žiadna faktúra.</p>
            ) : (
              <ul className="space-y-2">
                {order.invoices.map((invoice) => (
                  <li key={invoice.id} className="flex items-center justify-between text-sm">
                    <Link href={`/financie/faktury/${invoice.id}`} className="font-medium text-stone-900 hover:underline">
                      {invoice.invoiceNumber ?? "Koncept faktúry"}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="text-stone-600">{formatCents(invoice.totalGrossCents)}</span>
                      <Badge color={INVOICE_DOCUMENT_STATUS_COLORS[invoice.documentStatus]}>
                        {invoiceDocumentStatusLabels[invoice.documentStatus] ?? invoice.documentStatus}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>}
        </div>

        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-[14px] border border-stone-200 bg-white">
            <h2 className="border-b border-stone-100 px-5 py-3 font-semibold text-stone-900">Položky</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
                  <th className="px-5 py-2">Produkt</th>
                  <th className="px-5 py-2 text-right">Množstvo</th>
                  <th className="px-5 py-2 text-right">Cena/ks bez DPH</th>
                  <th className="px-5 py-2 text-right">DPH %</th>
                  <th className="px-5 py-2 text-right">Spolu bez DPH</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id} className="border-b border-stone-50 last:border-0">
                    <td className="px-5 py-2.5 font-medium text-stone-900">
                      {item.product.name} <span className="text-xs text-stone-400">({item.product.sku})</span>
                    </td>
                    <td className="px-5 py-2.5 text-right text-stone-600">{item.quantity} ks</td>
                    <td className="px-5 py-2.5 text-right text-stone-600">{item.unitPriceExact ? `${formatUnitPrice(item.unitPriceExact.toString())} €` : formatCents(item.unitPriceCents)}<div className="text-xs text-stone-400">{({ CLIENT: "Cenník klienta", B2B: "Základná B2B", B2C: "Katalógová B2C", MANUAL: "Ručná cena" } as Record<string, string>)[item.priceSource ?? ""] ?? "Historická cena"}</div>{item.minimumExpiryDate && <div className="text-xs text-stone-500">Min. exspirácia {formatDate(item.minimumExpiryDate)}</div>}</td>
                    <td className="px-5 py-2.5 text-right text-stone-600">{item.vatRate} %</td>
                    <td className="px-5 py-2.5 text-right font-medium text-stone-900">
                      {formatCents(item.unitPriceExact ? lineNetCents(item.quantity, item.unitPriceExact.toString()) : Math.round(item.quantity * item.unitPriceCents))}
                    </td>
                  </tr>
                ))}
                {order.charges.map((charge) => <tr key={charge.id} className="border-b border-stone-50 last:border-0">
                  <td className="px-5 py-2.5 font-medium text-stone-900">{charge.description}</td>
                  <td className="px-5 py-2.5 text-right text-stone-600">1</td>
                  <td className="px-5 py-2.5 text-right text-stone-600">{formatCents(charge.unitPriceCents)}</td>
                  <td className="px-5 py-2.5 text-right text-stone-600">{charge.vatRate} %</td>
                  <td className="px-5 py-2.5 text-right font-medium text-stone-900">{formatCents(charge.unitPriceCents)}</td>
                </tr>)}
              </tbody>
              <tfoot>
                <tr className="border-t border-stone-200 text-sm">
                  <td colSpan={4} className="px-5 py-2 text-right text-stone-500">Spolu bez DPH</td>
                  <td className="px-5 py-2 text-right font-medium text-stone-900">{formatCents(totals.totalNetCents)}</td>
                </tr>
                <tr className="text-sm">
                  <td colSpan={4} className="px-5 py-1 text-right text-stone-500">DPH</td>
                  <td className="px-5 py-1 text-right font-medium text-stone-900">{formatCents(totals.totalVatCents)}</td>
                </tr>
                <tr className="text-sm">
                  <td colSpan={4} className="px-5 py-2 text-right font-semibold text-stone-900">Spolu s DPH</td>
                  <td className="px-5 py-2 text-right text-base font-bold text-stone-950">{formatCents(totals.totalGrossCents)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          {order.movements.length > 0 && (
            <section className="rounded-[14px] border border-stone-200 bg-white">
              <h2 className="border-b border-stone-100 px-5 py-3 font-semibold text-stone-900">Skladové pohyby</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
                    <th className="px-5 py-2">Dátum</th>
                    <th className="px-5 py-2">Produkt</th>
                    <th className="px-5 py-2 text-right">Množstvo</th>
                    <th className="px-5 py-2">Šarža / exspirácia</th>
                    <th className="px-5 py-2">Poznámka</th>
                  </tr>
                </thead>
                <tbody>
                  {order.movements.map((movement) => (
                    <tr key={movement.id} className="border-b border-stone-50 last:border-0">
                      <td className="px-5 py-2.5 text-stone-600">{formatDateTime(movement.createdAt)}</td>
                      <td className="px-5 py-2.5 text-stone-900">{movement.product?.name ?? "—"}</td>
                      <td className={`px-5 py-2.5 text-right font-medium ${movement.quantity < 0 ? "text-red-700" : "text-stone-950"}`}>
                        {movement.quantity > 0 ? "+" : ""}{movement.quantity} ks
                      </td>
                      <td className="px-5 py-2.5 text-stone-600">
                        {movement.batch ? `${movement.batch.batchNumber} · ${formatDate(movement.batch.expiryDate)}` : "Neurčená"}
                      </td>
                      <td className="px-5 py-2.5 text-stone-600">{movement.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
