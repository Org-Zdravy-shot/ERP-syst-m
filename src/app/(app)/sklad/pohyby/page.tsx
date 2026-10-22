import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/Badge";
import { prisma } from "@/lib/prisma";
import { formatCents, formatDateTime, formatQty } from "@/lib/format";
import { MOVEMENT_TYPE_LABELS, type MovementType } from "@/lib/stock";
import { MovementForm } from "../MovementForm";
import { btnSecondary, card, table, thead, th, thRight, tr, tdMuted } from "@/components/ui";

export default async function PohybyPage() {
  const [movements, materials, products, batches] = await Promise.all([
    prisma.stockMovement.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        material: { select: { name: true, unit: true } },
        product: { select: { name: true, unit: true } },
        batch: { select: { batchNumber: true } },
        order: { select: { orderNumber: true } },
      },
    }),
    prisma.material.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, unit: true },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, unit: true },
    }),
    prisma.productionBatch.findMany({
      where: { status: "DONE" },
      orderBy: [{ expiryDate: "asc" }, { batchNumber: "asc" }],
      select: { id: true, productId: true, batchNumber: true, expiryDate: true },
    }),
  ]);

  return (
    <>
      <PageHeader title="Skladové pohyby" subtitle="Ledger — posledných 100 pohybov">
        <Link href="/sklad" className={btnSecondary}>
          ← Stavy zásob
        </Link>
      </PageHeader>

      <MovementForm materials={materials} products={products} batches={batches.map((batch) => ({
        ...batch, expiryDate: batch.expiryDate.toLocaleDateString("sk-SK"),
      }))} />

      <div className={`${card} overflow-x-auto`}>
        <table className={table}>
          <thead>
            <tr className={thead}>
              <th className="px-[18px] py-[11px] font-medium">Dátum</th>
              <th className="px-[18px] py-[11px] font-medium">Typ</th>
              <th className="px-[18px] py-[11px] font-medium">Položka</th>
              <th className="px-[18px] py-[11px] text-right font-medium">Množstvo</th>
              <th className="px-[18px] py-[11px] text-right font-medium">Cena/jedn.</th>
              <th className="px-[18px] py-[11px] font-medium">Väzba</th>
              <th className="px-[18px] py-[11px] font-medium">Poznámka</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => {
              const item = m.material ?? m.product;
              return (
                <tr key={m.id} className={tr}>
                  <td className="whitespace-nowrap px-[18px] py-2.5 text-stone-500">
                    {formatDateTime(m.createdAt)}
                  </td>
                  <td className="px-[18px] py-2.5">
                    <Badge color="gray">{MOVEMENT_TYPE_LABELS[m.type as MovementType] ?? m.type}</Badge>
                  </td>
                  <td className="px-[18px] py-2.5 text-stone-950">{item?.name ?? "—"}</td>
                  <td
                    className={`px-[18px] py-2.5 text-right font-medium tabular-nums ${
                      m.quantity < 0 ? "text-[#B91C1C]" : "text-[#1F7A0F]"
                    }`}
                  >
                    {m.quantity > 0 ? "+" : ""}
                    {formatQty(m.quantity, item?.unit)}
                  </td>
                  <td className="px-[18px] py-2.5 text-right tabular-nums text-stone-500">
                    {m.unitPriceCents != null ? formatCents(m.unitPriceCents) : "—"}
                  </td>
                  <td className="px-[18px] py-2.5 text-stone-500">
                    {m.batch?.batchNumber ?? m.order?.orderNumber ?? "—"}
                  </td>
                  <td className="max-w-56 truncate px-[18px] py-2.5 text-stone-500">{m.note ?? "—"}</td>
                </tr>
              );
            })}
            {movements.length === 0 && (
              <tr className={tr}>
                <td colSpan={7} className="px-[18px] py-8 text-center text-stone-400">
                  Zatiaľ žiadne pohyby
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
