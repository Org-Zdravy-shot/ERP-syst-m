import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/Badge";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { CompleteBatchButton } from "./CompleteBatchButton";
import { cancelBatch } from "./_actions";
import { btnPrimary, btnSecondary, btnSmall, card, table, thead, tr } from "@/components/ui";

const STATUS_BADGES: Record<string, { label: string; color: "yellow" | "emerald" | "gray" }> = {
  PLANNED: { label: "Naplánovaná", color: "yellow" },
  DONE: { label: "Hotová", color: "emerald" },
  CANCELLED: { label: "Zrušená", color: "gray" },
};

function ExpiryBadge({ expiryDate, status }: { expiryDate: Date; status: string }) {
  if (status !== "DONE") return <span className="text-stone-500">{formatDate(expiryDate)}</span>;
  const daysLeft = Math.ceil((expiryDate.getTime() - Date.now()) / (24 * 3600 * 1000));
  if (daysLeft < 0) return <Badge color="red">Exspirovaná {formatDate(expiryDate)}</Badge>;
  if (daysLeft <= 7) {
    return (
      <Badge color="yellow">
        {formatDate(expiryDate)} (o {daysLeft} d.)
      </Badge>
    );
  }
  return <span className="text-stone-500">{formatDate(expiryDate)}</span>;
}

export default async function VyrobaPage() {
  const batches = await prisma.productionBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { product: { select: { name: true } } },
  });

  return (
    <>
      <PageHeader title="Výroba" subtitle="Výrobné šarže a exspirácie">
        <Link href="/vyroba/receptury" className={btnSecondary}>
          Receptúry
        </Link>
        <Link href="/vyroba/nova" className={btnPrimary}>
          + Nová šarža
        </Link>
      </PageHeader>

      <div className={`${card} overflow-x-auto`}>
        <table className={table}>
          <thead>
            <tr className={thead}>
              <th className="px-[18px] py-[11px] font-medium">Šarža</th>
              <th className="px-[18px] py-[11px] font-medium">Produkt</th>
              <th className="px-[18px] py-[11px] text-right font-medium">Kusov</th>
              <th className="px-[18px] py-[11px] font-medium">Výroba</th>
              <th className="px-[18px] py-[11px] font-medium">Exspirácia</th>
              <th className="px-[18px] py-[11px] font-medium">Stav</th>
              <th className="px-[18px] py-[11px] font-medium">Akcie</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => {
              const status = STATUS_BADGES[batch.status] ?? STATUS_BADGES.PLANNED;
              return (
                <tr key={batch.id} className={tr}>
                  <td className="px-[18px] py-[11px] font-medium text-stone-950">
                    <Link href={`/vyroba/sarze/${batch.id}`} className="hover:underline">{batch.batchNumber}</Link>
                  </td>
                  <td className="px-[18px] py-[11px] text-stone-700">{batch.product.name}</td>
                  <td className="px-[18px] py-[11px] text-right tabular-nums">{batch.producedQty}</td>
                  <td className="whitespace-nowrap px-[18px] py-[11px] text-stone-500">
                    {formatDate(batch.productionDate)}
                  </td>
                  <td className="whitespace-nowrap px-[18px] py-[11px]">
                    <ExpiryBadge expiryDate={batch.expiryDate} status={batch.status} />
                  </td>
                  <td className="px-[18px] py-[11px]">
                    <Badge color={status.color}>{status.label}</Badge>
                  </td>
                  <td className="px-[18px] py-[11px]">
                    {batch.status === "PLANNED" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <CompleteBatchButton batchId={batch.id} />
                        <form action={cancelBatch} className="inline">
                          <input type="hidden" name="batchId" value={batch.id} />
                          <button type="submit" className={btnSmall}>
                            Zrušiť
                          </button>
                        </form>
                      </div>
                    ) : (
                      <span className="text-stone-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {batches.length === 0 && (
              <tr className={tr}>
                <td colSpan={7} className="px-[18px] py-8 text-center text-stone-400">
                  Zatiaľ žiadne šarže — vytvorte prvú tlačidlom „+ Nová šarža“
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
