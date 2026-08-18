import Link from "next/link";
import { Badge } from "@/components/Badge";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary, btnSecondary, card, filterPill, table, td, tdMuted, tdRight, th, thRight, thead, tr } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { formatCents, formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { calculateSupplierOrderTotals, type SupplierOrderStatus } from "@/lib/suppliers/domain";
import { supplierOrderStatusLabels } from "@/lib/zod-schemas";

const FILTERS: Array<{ value: string; label: string; statuses?: SupplierOrderStatus[] }> = [
  { value: "open", label: "Otvorené", statuses: ["DRAFT", "APPROVED", "SENT", "CONFIRMED", "PARTIALLY_RECEIVED"] },
  { value: "waiting", label: "Čakajú na dodanie", statuses: ["SENT", "CONFIRMED", "PARTIALLY_RECEIVED"] },
  { value: "received", label: "Prijaté", statuses: ["RECEIVED"] },
  { value: "cancelled", label: "Zrušené", statuses: ["CANCELLED"] },
  { value: "all", label: "Všetky" },
];

export default async function NakupneObjednavkyPage({
  searchParams,
}: {
  searchParams: Promise<{ stav?: string }>;
}) {
  const { stav } = await searchParams;
  const selected = FILTERS.find((filter) => filter.value === stav) ?? FILTERS[0];
  const session = await getSession();
  const canViewFinance = hasFinancePermission(session.role, "VIEW");
  const canCreate = hasFinancePermission(session.role, "CREATE_DRAFT");
  const orders = await prisma.supplierOrder.findMany({
    where: selected.statuses ? { status: { in: selected.statuses } } : {},
    include: {
      supplier: { select: { id: true, name: true } },
      items: { include: { deliveryItems: { select: { quantity: true } } } },
    },
    orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
    take: 250,
  });
  const now = Date.now();

  return (
    <>
      <PageHeader title="Nákupné objednávky" subtitle="Koncepty, potvrdenia, termíny a príjmy od dodávateľov">
        <Link href="/dodavatelia" className={btnSecondary}>Dodávatelia</Link>
        {canCreate && <Link href="/dodavatelia/objednavky/nova" className={btnPrimary}>+ Nová objednávka</Link>}
      </PageHeader>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((filter) => <Link key={filter.value} href={`/dodavatelia/objednavky?stav=${filter.value}`} className={filterPill(selected.value === filter.value)}>{filter.label}</Link>)}
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className={table}>
          <thead><tr className={thead}>
            <th className={th}>Objednávka</th>
            <th className={th}>Dodávateľ</th>
            <th className={th}>Stav</th>
            <th className={th}>Termín</th>
            <th className={th}>Príjem</th>
            {canViewFinance && <th className={thRight}>Suma s DPH</th>}
          </tr></thead>
          <tbody>
            {orders.map((order) => {
              const totals = canViewFinance ? calculateSupplierOrderTotals(
                order.items.map((item) => ({
                  quantity: item.quantity,
                  unitPriceCents: item.unitPriceCents,
                  pricePerQuantity: item.pricePerQuantity,
                  priceType: item.priceType as "NET" | "GROSS",
                  vatRate: item.vatRate,
                })),
                order.shippingCents,
                order.discountCents,
              ) : null;
              const completedItems = order.items.filter((item) => {
                const received = item.deliveryItems.reduce((sum, delivery) => sum + delivery.quantity, 0);
                return received >= item.quantity - 1e-9;
              }).length;
              const dueDate = order.confirmedDeliveryDate ?? order.requestedDeliveryDate;
              const overdue = dueDate && dueDate.getTime() < now && !["RECEIVED", "CANCELLED"].includes(order.status);
              return <tr key={order.id} className={tr}>
                <td className={td}>
                  <Link href={`/dodavatelia/objednavky/${order.id}`} className="font-semibold hover:underline">{order.orderNumber}</Link>
                  <div className="text-xs text-stone-400">{formatDate(order.orderDate)}</div>
                </td>
                <td className={td}><Link href={`/dodavatelia/${order.supplier.id}`} className="hover:underline">{order.supplier.name}</Link></td>
                <td className={td}><Badge color={order.status === "RECEIVED" ? "emerald" : order.status === "CANCELLED" ? "red" : "amber"}>{supplierOrderStatusLabels[order.status] ?? order.status}</Badge></td>
                <td className={overdue ? `${td} font-semibold text-red-700` : tdMuted}>{formatDate(dueDate)}{overdue && <div className="text-xs">po termíne</div>}</td>
                <td className={tdMuted}>{completedItems} / {order.items.length} položiek úplne</td>
                {canViewFinance && <td className={tdRight}>{totals ? formatCents(totals.totalGrossCents) : "—"}</td>}
              </tr>;
            })}
            {orders.length === 0 && <tr className={tr}><td colSpan={canViewFinance ? 6 : 5} className="px-5 py-14 text-center text-stone-400">V tomto filtri nie sú žiadne nákupné objednávky.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
