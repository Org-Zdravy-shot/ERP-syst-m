import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCents } from "@/lib/format";
import { btnPrimary, btnSecondary, card, cardHeader, table, thead, tr, td, tdRight, tdRightMuted } from "@/components/ui";

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[14px] border border-stone-200 border-t-[3px] border-t-brand bg-white px-5 py-[18px]">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">{label}</div>
      <div className="mt-2 whitespace-nowrap font-display text-[22px] font-bold text-stone-950">{value}</div>
      {hint && <div className="mt-1 text-xs text-stone-400">{hint}</div>}
    </div>
  );
}

export default async function FinanciePage() {
  const session = await getSession();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [issuedDocuments, receivedDocuments, outstandingInvoices, ekasaThisMonth, products] =
    await Promise.all([
      prisma.invoice.findMany({
        where: { direction: "VYDANA", documentStatus: "ISSUED", issueDate: { gte: monthStart } },
        select: { documentType: true, totalGrossCents: true },
      }),
      prisma.invoice.findMany({
        where: { direction: "PRIJATA", documentStatus: "ISSUED", issueDate: { gte: monthStart } },
        select: { documentType: true, totalGrossCents: true },
      }),
      prisma.invoice.findMany({
        where: { direction: "VYDANA", documentType: "INVOICE", documentStatus: "ISSUED" },
        select: {
          totalGrossCents: true,
          dueDate: true,
          paymentAllocations: { where: { reversedAt: null }, select: { amountCents: true } },
        },
      }),
      prisma.ekasaSale.aggregate({
        where: { saleDate: { gte: monthStart } },
        _sum: { totalGrossCents: true },
      }),
      prisma.product.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        include: { recipe: { include: { items: { include: { material: true } } } } },
      }),
    ]);

  const signedTotal = (documents: Array<{ documentType: string; totalGrossCents: number }>) =>
    documents.reduce(
      (sum, document) => sum + document.totalGrossCents * (document.documentType === "CREDIT_NOTE" ? -1 : 1),
      0,
    );
  const issuedThisMonthCents = signedTotal(issuedDocuments);
  const receivedThisMonthCents = signedTotal(receivedDocuments);
  const outstanding = outstandingInvoices.map((invoice) => {
    const allocated = invoice.paymentAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
    return { dueDate: invoice.dueDate, remainingCents: Math.max(0, invoice.totalGrossCents - allocated) };
  });
  const unpaidCents = outstanding.reduce((sum, invoice) => sum + invoice.remainingCents, 0);
  const unpaidCount = outstanding.filter((invoice) => invoice.remainingCents > 0).length;
  const overdue = outstanding.filter(
    (invoice) => invoice.remainingCents > 0 && invoice.dueDate.getTime() < now.getTime(),
  ).length;
  const revenueThisMonth =
    issuedThisMonthCents + (ekasaThisMonth._sum.totalGrossCents ?? 0);

  // Jednotková ekonomika: náklad surovín na kus podľa receptúry × posledné nákupné ceny
  const margins = products
    .filter((p) => p.recipe && p.recipe.items.length > 0)
    .map((p) => {
      const recipe = p.recipe!;
      const costPerBatchCents = recipe.items.reduce(
        (sum, item) => sum + item.quantity * item.material.lastPriceCents,
        0,
      );
      const costPerUnitCents = Math.round(costPerBatchCents / recipe.batchSize);
      const marginPct = (priceCents: number) =>
        priceCents > 0 ? Math.round(((priceCents - costPerUnitCents) / priceCents) * 100) : 0;
      return {
        id: p.id,
        name: p.name,
        costPerUnitCents,
        priceB2bCents: p.priceB2bCents,
        marginB2bPct: marginPct(p.priceB2bCents),
        priceB2cCents: p.priceB2cCents,
        marginB2cPct: marginPct(p.priceB2cCents),
      };
    });

  return (
    <>
      <PageHeader title="Financie" subtitle="Faktúry, eKasa, marže a export pre účtovníka">
        <a href="/financie/export" className={btnSecondary} download>
          ⬇ Export CSV
        </a>
        <Link href="/financie/faktury" className={btnPrimary}>
          Faktúry
        </Link>
      </PageHeader>

      <div className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Tržby tento mesiac"
          value={formatCents(revenueThisMonth)}
          hint={`${issuedDocuments.length} dokladov + eKasa`}
        />
        <KpiCard
          label="Neuhradené faktúry"
          value={formatCents(unpaidCents)}
          hint={`${unpaidCount} vydaných čaká na úhradu`}
        />
        <KpiCard
          label="Po splatnosti"
          value={String(overdue)}
          hint={overdue > 0 ? "faktúr treba urgovať" : "všetko v termíne"}
        />
        <KpiCard
          label="Náklady tento mesiac"
          value={formatCents(receivedThisMonthCents)}
          hint={`${receivedDocuments.length} prijatých dokladov`}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <div className={card}>
            <div className={cardHeader}>Marže podľa receptúr (posledné nákupné ceny surovín)</div>
            <table className={table}>
              <thead>
                <tr className={thead}>
                  <th className="px-[18px] py-2 font-medium">Produkt</th>
                  <th className="px-[18px] py-2 text-right font-medium">Náklad/ks</th>
                  <th className="px-[18px] py-2 text-right font-medium">Cena B2B</th>
                  <th className="px-[18px] py-2 text-right font-medium">Marža B2B</th>
                  <th className="px-[18px] py-2 text-right font-medium">Cena B2C</th>
                  <th className="px-[18px] py-2 text-right font-medium">Marža B2C</th>
                </tr>
              </thead>
              <tbody>
                {margins.map((m) => (
                  <tr key={m.id} className={tr}>
                    <td className={`${td} font-medium`}>{m.name}</td>
                    <td className={tdRightMuted}>{formatCents(m.costPerUnitCents)}</td>
                    <td className={tdRight}>{formatCents(m.priceB2bCents)}</td>
                    <td className={`px-[18px] py-[9px] text-right font-semibold tabular-nums ${m.marginB2bPct < 30 ? "text-red-600" : "text-[#1F7A0F]"}`}>
                      {m.marginB2bPct} %
                    </td>
                    <td className={tdRight}>{formatCents(m.priceB2cCents)}</td>
                    <td className={`px-[18px] py-[9px] text-right font-semibold tabular-nums ${m.marginB2cPct < 30 ? "text-red-600" : "text-[#1F7A0F]"}`}>
                      {m.marginB2cPct} %
                    </td>
                  </tr>
                ))}
                {margins.length === 0 && (
                  <tr className={tr}>
                    <td colSpan={6} className="px-[18px] py-8 text-center text-stone-400">
                      Žiadne produkty s receptúrou — marže sa počítajú z receptúr a nákupných cien
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="border-t border-stone-100 px-[18px] py-2.5 text-xs text-stone-400">
              Náklad zahŕňa suroviny a obaly podľa receptúry; nezahŕňa prácu, energie a réžiu.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {[
            { href: "/financie/faktury", title: "Faktúry", desc: "Koncepty, finalizácia, úhrady a nemenné doklady." },
            { href: "/financie/banka", title: "Banka", desc: "Tatra Premium API / import výpisov, transakcie a automatické párovanie platieb." },
            { href: "/financie/cashflow", title: "Cash-flow", desc: "Mesačné toky z platieb, aging neuhradených faktúr a očakávané výdavky." },
            { href: "/financie/import", title: "Historická migrácia", desc: "Kontrolovaný Omega import; nové doklady vznikajú iba v ERP." },
            { href: "/financie/ekasa", title: "eKasa", desc: "Import hotovostných predajov z pokladne, deduplikácia dokladov." },
            ...(hasFinancePermission(session.role, "CONFIGURE")
              ? [{
                  href: "/financie/nastavenia",
                  title: "Nastavenia financií",
                  desc: "Firemný profil, DPH, bankový účet, číselný rad a produkčný go-live.",
                }]
              : []),
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-[14px] border border-stone-200 bg-white p-5 transition hover:border-stone-300 hover:bg-stone-50"
            >
              <div className="text-[13.5px] font-semibold text-stone-950">{item.title} →</div>
              <p className="mt-1 text-sm text-stone-500">{item.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
