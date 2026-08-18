import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary, card, cardHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { formatCents, formatDate, formatDateTime, formatQty } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  calculateSupplierOrderTotals,
  canTransitionSupplierOrder,
  type SupplierOrderStatus,
} from "@/lib/suppliers/domain";
import { supplierOrderStatusLabels } from "@/lib/zod-schemas";
import { receiveSupplierOrder, transitionSupplierOrder } from "../../_order-actions";
import { SupplierOrderTransitions, SupplierReceiptForm } from "../../SupplierOrderActions";

export default async function NakupnaObjednavkaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const canViewFinance = hasFinancePermission(session.role, "VIEW");
  const canEdit = hasFinancePermission(session.role, "CREATE_DRAFT");
  const canConfigure = hasFinancePermission(session.role, "CONFIGURE");
  const canSend = hasFinancePermission(session.role, "SEND_DOCUMENT");
  const order = await prisma.supplierOrder.findUnique({
    where: { id },
    include: {
      supplier: {
        include: {
          returnableTypes: { where: { isActive: true }, orderBy: { name: "asc" } },
        },
      },
      items: {
        include: {
          material: { select: { name: true } },
          product: { select: { name: true, sku: true } },
          deliveryItems: { include: { supplierDelivery: true, stockMovement: true }, orderBy: { createdAt: "asc" } },
        },
        orderBy: { lineNumber: "asc" },
      },
      deliveries: {
        include: { items: { include: { supplierOrderItem: true } }, returnableMovements: { include: { returnableType: true } } },
        orderBy: { receivedAt: "desc" },
      },
    },
  });
  if (!order) notFound();
  const totals = calculateSupplierOrderTotals(
    order.items.map((item) => ({
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      pricePerQuantity: item.pricePerQuantity,
      priceType: item.priceType as "NET" | "GROSS",
      vatRate: item.vatRate,
    })),
    order.shippingCents,
    order.discountCents,
  );
  const currentStatus = order.status as SupplierOrderStatus;
  const candidates: SupplierOrderStatus[] = ["APPROVED", "SENT", "CONFIRMED", "CANCELLED"];
  const transitions = candidates
    .filter((to) => canTransitionSupplierOrder(currentStatus, to))
    .filter((to) => to === "APPROVED" || to === "CANCELLED" ? canConfigure : to === "SENT" ? canSend : true)
    .map((to) => ({ to, action: transitionSupplierOrder.bind(null, order.id, to) }));
  const canReceive = currentStatus === "CONFIRMED" || currentStatus === "PARTIALLY_RECEIVED";
  const supplierSnapshot = order.supplierSnapshot as Record<string, unknown> | null;
  const deliverySnapshot = order.deliveryLocationSnapshot as Record<string, unknown> | null;

  return (
    <>
      <PageHeader title={order.orderNumber} subtitle={`Nákupná objednávka · ${order.supplier.name}`}>
        {order.status === "DRAFT" && canEdit && <Link href={`/dodavatelia/objednavky/${order.id}/upravit`} className={btnSecondary}>Upraviť koncept</Link>}
        <Link href="/dodavatelia/objednavky" className={btnSecondary}>← Späť</Link>
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6">
          <section className={`${card} p-5`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-stone-900">Stav a termíny</h2>
              <Badge color={order.status === "RECEIVED" ? "emerald" : order.status === "CANCELLED" ? "red" : "amber"}>{supplierOrderStatusLabels[order.status] ?? order.status}</Badge>
            </div>
            <dl className="divide-y divide-stone-100 text-sm">
              <div className="flex justify-between py-2"><dt className="text-stone-500">Vytvorená</dt><dd className="font-medium">{formatDateTime(order.createdAt)}</dd></div>
              <div className="flex justify-between py-2"><dt className="text-stone-500">Požadovaný termín</dt><dd className="font-medium">{formatDate(order.requestedDeliveryDate)}</dd></div>
              <div className="flex justify-between py-2"><dt className="text-stone-500">Potvrdený termín</dt><dd className="font-medium">{formatDate(order.confirmedDeliveryDate)}</dd></div>
              {order.approvedAt && <div className="flex justify-between py-2"><dt className="text-stone-500">Schválená</dt><dd className="font-medium">{formatDateTime(order.approvedAt)}</dd></div>}
              {order.sentAt && <div className="flex justify-between py-2"><dt className="text-stone-500">Odoslaná</dt><dd className="font-medium">{formatDateTime(order.sentAt)}</dd></div>}
              {order.confirmedAt && <div className="flex justify-between py-2"><dt className="text-stone-500">Potvrdená</dt><dd className="font-medium">{formatDateTime(order.confirmedAt)}</dd></div>}
            </dl>
            {order.cancelReason && <p className="mt-3 rounded-[10px] bg-red-50 p-3 text-sm text-red-700">Dôvod zrušenia: {order.cancelReason}</p>}
            {order.note && <p className="mt-3 rounded-[10px] bg-amber-50 p-3 text-sm text-amber-900">{order.note}</p>}
          </section>

          <section className={card}>
            <h2 className={cardHeader}>Dodávateľ a doručenie</h2>
            <div className="space-y-3 p-5 text-sm">
              <div><Link href={`/dodavatelia/${order.supplier.id}`} className="font-semibold text-stone-900 hover:underline">{String(supplierSnapshot?.legalName ?? supplierSnapshot?.name ?? order.supplier.name)}</Link></div>
              {supplierSnapshot?.ico ? <div className="text-stone-500">IČO {String(supplierSnapshot.ico)}</div> : null}
              {supplierSnapshot?.email ? <a href={`mailto:${String(supplierSnapshot.email)}`} className="text-stone-600 hover:underline">{String(supplierSnapshot.email)}</a> : null}
              {deliverySnapshot && <div className="border-t border-stone-100 pt-3 text-stone-600">
                <div className="text-xs font-semibold uppercase tracking-wide text-stone-400">Doručiť na</div>
                <div className="mt-1">{String(deliverySnapshot.legalName ?? "")}</div>
                <div>{[deliverySnapshot.street, deliverySnapshot.zip, deliverySnapshot.city, deliverySnapshot.country].filter(Boolean).map(String).join(", ")}</div>
              </div>}
            </div>
          </section>

          {!(["RECEIVED", "CANCELLED"] as string[]).includes(order.status) && <section className={`${card} p-5`}>
            <h2 className="mb-3 font-semibold text-stone-900">Ďalší krok</h2>
            <SupplierOrderTransitions transitions={transitions} />
            {order.status === "APPROVED" && <p className="mt-3 text-xs text-stone-400">Tlačidlo zatiaľ zaznamená vedomé odoslanie. PDF a automatické odoslanie e-mailom je samostatná etapa S3.</p>}
          </section>}
        </div>

        <div className="space-y-6 xl:col-span-2">
          <section className={`${card} overflow-x-auto`}>
            <h2 className={cardHeader}>Položky</h2>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-stone-100 text-left text-xs uppercase tracking-wide text-stone-400">
                <th className="px-5 py-2">Položka</th><th className="px-5 py-2 text-right">Objednané</th><th className="px-5 py-2 text-right">Prijaté</th>{canViewFinance && <><th className="px-5 py-2 text-right">Cena</th><th className="px-5 py-2 text-right">Spolu</th></>}
              </tr></thead>
              <tbody>{order.items.map((item, index) => {
                const received = item.deliveryItems.reduce((sum, delivery) => sum + delivery.quantity, 0);
                const lineTotal = totals.lines[index];
                return <tr key={item.id} className="border-b border-stone-50 last:border-0">
                  <td className="px-5 py-3"><div className="font-medium text-stone-900">{item.description}</div><div className="text-xs text-stone-400">{item.material?.name ? `Surovina · ${item.material.name}` : item.product?.name ? `Produkt · ${item.product.name}` : "Služba"}{item.supplierSku ? ` · SKU ${item.supplierSku}` : ""}</div></td>
                  <td className="px-5 py-3 text-right">{formatQty(item.quantity, item.unit)}</td>
                  <td className={`px-5 py-3 text-right font-medium ${received >= item.quantity ? "text-emerald-700" : received > 0 ? "text-amber-700" : "text-stone-400"}`}>{formatQty(received, item.unit)}</td>
                  {canViewFinance && <><td className="px-5 py-3 text-right text-stone-600">{formatCents(item.unitPriceCents)} / {formatQty(item.pricePerQuantity, item.unit)}<div className="text-xs text-stone-400">{item.priceType === "NET" ? "bez DPH" : "s DPH"} · {item.vatRate} %</div></td><td className="px-5 py-3 text-right font-semibold">{formatCents(lineTotal.totalGrossCents)}</td></>}
                </tr>;
              })}</tbody>
              {canViewFinance && <tfoot className="border-t border-stone-200 text-sm"><tr><td colSpan={4} className="px-5 pt-3 text-right text-stone-500">Položky + DPH</td><td className="px-5 pt-3 text-right font-medium">{formatCents(totals.lines.reduce((sum, line) => sum + line.totalGrossCents, 0))}</td></tr><tr><td colSpan={4} className="px-5 py-1 text-right text-stone-500">Doprava / zľava</td><td className="px-5 py-1 text-right">{formatCents(order.shippingCents)} / −{formatCents(order.discountCents)}</td></tr><tr><td colSpan={4} className="px-5 pb-4 pt-2 text-right font-semibold">Spolu s DPH</td><td className="px-5 pb-4 pt-2 text-right text-base font-bold">{formatCents(totals.totalGrossCents)}</td></tr></tfoot>}
            </table>
          </section>

          {canReceive && <section className={card}>
            <h2 className={cardHeader}>Prijať dodávku</h2>
            <div className="p-5">
              <SupplierReceiptForm
                action={receiveSupplierOrder.bind(null, order.id)}
                idempotencyKey={randomUUID()}
                items={order.items.map((item) => ({ id: item.id, description: item.description, unit: item.unit, orderedQuantity: item.quantity, receivedQuantity: item.deliveryItems.reduce((sum, delivery) => sum + delivery.quantity, 0) }))}
                returnables={order.supplier.returnableTypes.map((item) => ({ id: item.id, name: item.name, unit: item.unit, expectedReturnDays: item.expectedReturnDays }))}
              />
            </div>
          </section>}

          <section className={card}>
            <h2 className={cardHeader}>Prijaté dodávky ({order.deliveries.length})</h2>
            <div className="divide-y divide-stone-100">
              {order.deliveries.map((delivery) => <div key={delivery.id} className="px-5 py-4">
                <div className="flex justify-between gap-3"><div className="font-medium text-stone-900">{delivery.deliveryNoteNumber ? `Dodací list ${delivery.deliveryNoteNumber}` : "Príjem bez čísla dodacieho listu"}</div><div className="text-sm text-stone-500">{formatDateTime(delivery.receivedAt)}</div></div>
                <div className="mt-2 flex flex-wrap gap-2">{delivery.items.map((item) => <Badge key={item.id} color="emerald">{item.supplierOrderItem.description}: {formatQty(item.quantity, item.supplierOrderItem.unit)}</Badge>)}{delivery.returnableMovements.map((movement) => <Badge key={movement.id} color="amber">{movement.returnableType.name}: +{formatQty(movement.quantity, movement.returnableType.unit)}</Badge>)}</div>
                {delivery.note && <p className="mt-2 text-xs text-stone-500">{delivery.note}</p>}
              </div>)}
              {order.deliveries.length === 0 && <p className="px-5 py-8 text-sm text-stone-400">Zatiaľ nebola prijatá žiadna dodávka.</p>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
