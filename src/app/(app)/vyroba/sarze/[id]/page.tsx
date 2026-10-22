import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { formatDate, formatQty } from "@/lib/format";

export default async function SarzaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [batch, movements] = await Promise.all([
    prisma.productionBatch.findUnique({
      where: { id }, include: { product: { select: { name: true, sku: true, unit: true } } },
    }),
    prisma.stockMovement.findMany({
      where: { batchId: id, type: "PREDAJ", orderId: { not: null } },
      select: { id: true, quantity: true, orderId: true, order: {
        select: { id: true, orderNumber: true, orderDate: true, deliveryDate: true, client: {
          select: { id: true, name: true, email: true, phone: true },
        } },
      } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!batch) notFound();
  const shipped = movements.reduce((sum, movement) => sum - movement.quantity, 0);
  const balance = await prisma.stockMovement.aggregate({ where: { batchId: id, productId: batch.productId }, _sum: { quantity: true } });
  const byOrder = new Map<string, { order: NonNullable<(typeof movements)[number]["order"]>; quantity: number }>();
  for (const movement of movements) {
    if (!movement.order) continue;
    const previous = byOrder.get(movement.order.id);
    byOrder.set(movement.order.id, { order: movement.order, quantity: (previous?.quantity ?? 0) - movement.quantity });
  }

  return <>
    <PageHeader title={`Šarža ${batch.batchNumber}`} subtitle={`${batch.product.name} · ${batch.product.sku}`}>
      <Link href="/vyroba" className="rounded-[10px] border border-stone-300 bg-white px-4 py-2 text-sm">← Všetky šarže</Link>
    </PageHeader>
    <div className="mb-5 grid gap-3 sm:grid-cols-4">
      {[
        ["Vyrobené", formatQty(batch.producedQty, batch.product.unit)],
        ["Na sklade v šarži", formatQty(balance._sum.quantity ?? 0, batch.product.unit)],
        ["Expedované", formatQty(shipped, batch.product.unit)],
        ["Exspirácia", formatDate(batch.expiryDate)],
      ].map(([label, value]) => <div key={label} className="rounded-[14px] border border-stone-200 bg-white p-4">
        <div className="text-xs text-stone-500">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div>
      </div>)}
    </div>
    <section className="rounded-[14px] border border-stone-200 bg-white">
      <div className="border-b border-stone-100 px-5 py-3">
        <h2 className="font-semibold">Odberatelia tejto šarže</h2>
        <p className="mt-1 text-xs text-stone-500">Zoznam vychádza z expedícií s priradenou šaržou. Staršie výdaje bez šarže tu nemožno spoľahlivo priradiť.</p>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-stone-100 bg-stone-50 text-left text-xs uppercase text-stone-500">
          <th className="px-5 py-3">Objednávka</th><th className="px-5 py-3">Odberateľ</th><th className="px-5 py-3">Kontakt</th><th className="px-5 py-3">Dodanie</th><th className="px-5 py-3 text-right">Kusov</th>
        </tr></thead>
        <tbody>{[...byOrder.values()].map(({ order, quantity }) => <tr key={order.id} className="border-b border-stone-100 last:border-0">
          <td className="px-5 py-3"><Link href={`/objednavky/${order.id}`} className="font-medium hover:underline">{order.orderNumber}</Link></td>
          <td className="px-5 py-3"><Link href={`/klienti/${order.client.id}`} className="hover:underline">{order.client.name}</Link></td>
          <td className="px-5 py-3">{[order.client.email, order.client.phone].filter(Boolean).join(" · ") || "—"}</td>
          <td className="px-5 py-3">{formatDate(order.deliveryDate ?? order.orderDate)}</td>
          <td className="px-5 py-3 text-right">{formatQty(quantity, batch.product.unit)}</td>
        </tr>)}</tbody>
      </table>{byOrder.size === 0 && <p className="px-5 py-6 text-sm text-stone-500">Zatiaľ bez priradenej expedície.</p>}</div>
    </section>
  </>;
}
