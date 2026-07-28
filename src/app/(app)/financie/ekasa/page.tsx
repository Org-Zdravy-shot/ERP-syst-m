import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { formatCents, formatQty } from "@/lib/format";
import { btnSecondary, card, cardHeader, table, thead, tr, td, tdMuted, tdRight } from "@/components/ui";
import { EkasaImport } from "./EkasaImport";
import { ManualEkasaForm } from "./ManualEkasaForm";

const saleDateTime = new Intl.DateTimeFormat("sk-SK", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Bratislava",
});

export default async function EkasaPage() {
  const sales = await prisma.ekasaSale.findMany({
    orderBy: { saleDate: "desc" },
    take: 100,
    include: { product: { select: { name: true } } },
  });

  return (
    <>
      <PageHeader title="eKasa" subtitle="Import a evidencia hotovostných predajov z pokladne">
        <Link href="/financie" className={btnSecondary}>
          ← Späť na financie
        </Link>
      </PageHeader>

      <div className="max-w-4xl space-y-5">
        <EkasaImport />
        <ManualEkasaForm />

        <div className={card}>
          <div className={cardHeader}>Posledné predaje (100)</div>
          <table className={table}>
            <thead>
              <tr className={thead}>
                <th className="px-[18px] py-2 font-medium">Dátum</th>
                <th className="px-[18px] py-2 font-medium">Doklad</th>
                <th className="px-[18px] py-2 font-medium">Popis</th>
                <th className="px-[18px] py-2 font-medium">Produkt</th>
                <th className="px-[18px] py-2 font-medium">Zdroj</th>
                <th className="px-[18px] py-2 text-right font-medium">Množstvo</th>
                <th className="px-[18px] py-2 text-right font-medium">Suma s DPH</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id} className={tr}>
                  <td className={`${tdMuted} whitespace-nowrap`}>{saleDateTime.format(sale.saleDate)}</td>
                  <td className={tdMuted}>{sale.receiptNumber ?? "—"}</td>
                  <td className={td}>{sale.description ?? "—"}</td>
                  <td className={tdMuted}>{sale.product?.name ?? "—"}</td>
                  <td className={tdMuted}>
                    {sale.source === "VRP2_XLSX"
                      ? "VRP2"
                      : sale.source === "MANUAL"
                        ? "Manuálne"
                        : sale.source}
                  </td>
                  <td className={tdRight}>{formatQty(sale.quantity)}</td>
                  <td className={tdRight}>{formatCents(sale.totalGrossCents)}</td>
                </tr>
              ))}
              {sales.length === 0 && (
                <tr className={tr}>
                  <td colSpan={7} className="px-[18px] py-8 text-center text-stone-400">
                    Zatiaľ žiadne importované predaje
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
