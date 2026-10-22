import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime } from "@/lib/format";

const stateLabels: Record<string, string> = {
  IMPORTED: "Synchronizovaná", NEEDS_REVIEW: "Skontrolovať", IGNORED: "Zrušená / ignorovaná",
};

export default async function WooSynchronizaciaPage() {
  const [records, issueCount] = await Promise.all([
    prisma.wooOrderSync.findMany({
      orderBy: { lastSeenAt: "desc" }, take: 100,
      include: { order: { select: { id: true, orderNumber: true } } },
    }),
    prisma.wooOrderSync.count({ where: { state: "NEEDS_REVIEW" } }),
  ]);
  return <>
    <PageHeader title="WooCommerce synchronizácia" subtitle={`${issueCount} objednávok potrebuje kontrolu`}>
      <Link href="/objednavky" className="rounded-[10px] border border-stone-300 bg-white px-4 py-2 text-sm">← Objednávky</Link>
    </PageHeader>
    <p className="mb-4 rounded-[10px] bg-amber-50 p-4 text-sm text-amber-900">
      ERP automaticky prevezme len objednávky s jednoznačným SKU a presne zhodnou cenou a DPH vrátane dopravy a poplatkov. Nejednoznačná sadzba, neznáme produkty a zmeny po spracovaní zostanú na kontrolu; neúplná objednávka sa nevytvorí.
    </p>
    <div className="overflow-x-auto rounded-[14px] border border-stone-200 bg-white"><table className="w-full text-sm">
      <thead><tr className="border-b border-stone-100 bg-stone-50 text-left text-xs uppercase text-stone-500">
        <th className="px-4 py-3">Woo ID</th><th className="px-4 py-3">ERP objednávka</th><th className="px-4 py-3">Stav</th><th className="px-4 py-3">Posledná udalosť</th><th className="px-4 py-3">Dôvod</th>
      </tr></thead>
      <tbody>{records.map((record) => <tr key={record.id} className="border-b border-stone-100 last:border-0">
        <td className="px-4 py-3 font-medium">#{record.externalOrderId}</td>
        <td className="px-4 py-3">{record.order ? <Link href={`/objednavky/${record.order.id}`} className="hover:underline">{record.order.orderNumber}</Link> : "—"}</td>
        <td className="px-4 py-3">{stateLabels[record.state] ?? record.state}</td>
        <td className="px-4 py-3 text-stone-600">{formatDateTime(record.lastSeenAt)}</td>
        <td className="px-4 py-3 text-stone-600">{record.issue ?? "—"}</td>
      </tr>)}</tbody>
      </table>{records.length === 0 && <p className="px-4 py-8 text-center text-sm text-stone-500">Zatiaľ neprišla žiadna WooCommerce udalosť.</p>}</div>
  </>;
}
