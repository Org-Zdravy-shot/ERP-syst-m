import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { formatCents, formatQty } from "@/lib/format";
import { btnSecondary, card, cardHeader, table, thead, tr, td, tdMuted, tdRight } from "@/components/ui";
import { EkasaImport } from "./EkasaImport";
import { ManualEkasaForm } from "./ManualEkasaForm";
import { MatchForm } from "./MatchForm";
import { matchEkasaReceipt, unmatchEkasaReceipt } from "./_actions";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";

const saleDateTime = new Intl.DateTimeFormat("sk-SK", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Bratislava",
});

export default async function EkasaPage() {
  const [sales, session] = await Promise.all([prisma.ekasaSale.findMany({
    orderBy: { saleDate: "desc" },
    take: 100,
    include: { product: { select: { name: true } }, matchedInvoice: { select: { id: true, invoiceNumber: true } } },
  }), getSession()]);
  const canMatch = hasFinancePermission(session.role, "CONFIGURE");
  const shownReceipts = new Set<string>();

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
        <p className="rounded-[10px] bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Ak ten istý predaj eviduje eKasa aj vydaná faktúra, spárujte celý eKasa doklad s presným číslom faktúry. ERP vyžaduje zhodnú sumu s DPH; spárovaný doklad sa v prehľade tržieb nesčíta druhýkrát.
        </p>

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
                <th className="px-[18px] py-2 font-medium">Faktúra</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => {
                const receiptKey = `${sale.source}|${sale.receiptNumber ?? sale.id}|${sale.saleDate.toISOString().slice(0, 10)}`;
                const firstInReceipt = !shownReceipts.has(receiptKey);
                shownReceipts.add(receiptKey);
                return (
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
                  <td className="px-[18px] py-2.5">
                    {sale.matchedInvoice && <Link href={`/financie/faktury/${sale.matchedInvoice.id}`} className="text-sm font-medium hover:underline">{sale.matchedInvoice.invoiceNumber}</Link>}
                    {canMatch && firstInReceipt && sale.receiptNumber && <MatchForm
                      action={(sale.matchedInvoice ? unmatchEkasaReceipt : matchEkasaReceipt).bind(null, sale.id)}
                      label={sale.matchedInvoice ? "unmatch" : "match"}
                    />}
                    {!sale.matchedInvoice && !canMatch && "—"}
                  </td>
                </tr>
              ); })}
              {sales.length === 0 && (
                <tr className={tr}>
                  <td colSpan={8} className="px-[18px] py-8 text-center text-stone-400">
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
