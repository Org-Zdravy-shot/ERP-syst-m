import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCents } from "@/lib/format";
import { btnPrimary, btnSecondary, card, cardHeader, table, thead, tr, td, tdRight, tdRightMuted } from "@/components/ui";
import { legalEntityLabels } from "@/lib/zod-schemas";

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[14px] border border-stone-200 border-t-[3px] border-t-brand bg-white px-5 py-[18px]">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">{label}</div>
      <div className="mt-2 whitespace-nowrap font-display text-[22px] font-bold text-stone-950">{value}</div>
      {hint && <div className="mt-1 text-xs text-stone-400">{hint}</div>}
    </div>
  );
}

export default async function FinanciePage({ searchParams }: { searchParams: Promise<{ subjekt?: string }> }) {
  const { subjekt } = await searchParams;
  const entity = subjekt === "UNASSIGNED" || (subjekt && subjekt in legalEntityLabels) ? subjekt : undefined;
  const session = await getSession();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [issuedDocuments, receivedDocuments, outstandingInvoices, ekasaThisMonth, matchedEkasaThisMonth, cashIn, cashOut, products] =
    await Promise.all([
      prisma.invoice.findMany({
        where: { direction: "VYDANA", documentStatus: "ISSUED", currency: "EUR", ...(entity ? { legalEntity: entity === "UNASSIGNED" ? null : entity } : {}), issueDate: { gte: monthStart } },
        select: { documentType: true, totalGrossCents: true },
      }),
      prisma.invoice.findMany({
        where: { direction: "PRIJATA", documentStatus: "ISSUED", currency: "EUR", ...(entity ? { legalEntity: entity === "UNASSIGNED" ? null : entity } : {}), issueDate: { gte: monthStart } },
        select: { documentType: true, totalGrossCents: true },
      }),
      prisma.invoice.findMany({
        where: { direction: "VYDANA", documentType: "INVOICE", documentStatus: "ISSUED", currency: "EUR", source: { not: "HISTORICAL" }, ...(entity ? { legalEntity: entity === "UNASSIGNED" ? null : entity } : {}) },
        select: {
          totalGrossCents: true,
          dueDate: true,
          paymentAllocations: { where: { reversedAt: null }, select: { amountCents: true } },
        },
      }),
      entity ? Promise.resolve({ _sum: { totalGrossCents: 0 } }) : prisma.ekasaSale.aggregate({
        where: { saleDate: { gte: monthStart }, matchedInvoiceId: null },
        _sum: { totalGrossCents: true },
      }),
      entity ? Promise.resolve({ _sum: { totalGrossCents: 0 } }) : prisma.ekasaSale.aggregate({
        where: { saleDate: { gte: monthStart }, matchedInvoiceId: { not: null } },
        _sum: { totalGrossCents: true },
      }),
      entity ? Promise.resolve({ _sum: { amountCents: 0 } }) : prisma.payment.aggregate({ where: { direction: "INCOMING", paidAt: { gte: monthStart } }, _sum: { amountCents: true } }),
      entity ? Promise.resolve({ _sum: { amountCents: 0 } }) : prisma.payment.aggregate({ where: { direction: "OUTGOING", paidAt: { gte: monthStart } }, _sum: { amountCents: true } }),
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
        marginB2bPct: p.priceB2bCents === null ? null : marginPct(p.priceB2bCents),
        priceB2cCents: p.priceB2cCents,
        marginB2cPct: marginPct(p.priceB2cCents),
      };
    });

  return (
    <>
      <PageHeader title="Financie" subtitle="Faktúry, eKasa, marže a export pre účtovníka">
        <a href={entity ? `/financie/export?subjekt=${entity}` : "/financie/export"} className={btnSecondary} download>
          ⬇ Export CSV
        </a>
        <Link href="/financie/faktury" className={btnPrimary}>
          Faktúry
        </Link>
      </PageHeader>

      <div className="mb-4 flex flex-wrap gap-2 text-sm"><Link href="/financie" className={`rounded-[8px] border px-3 py-1.5 ${!entity ? "bg-stone-900 text-white" : "bg-white"}`}>Všetky subjekty</Link>{Object.entries(legalEntityLabels).map(([key, title]) => <Link key={key} href={`/financie?subjekt=${key}`} className={`rounded-[8px] border px-3 py-1.5 ${entity === key ? "bg-stone-900 text-white" : "bg-white"}`}>{title}</Link>)}<Link href="/financie?subjekt=UNASSIGNED" className={`rounded-[8px] border px-3 py-1.5 ${entity === "UNASSIGNED" ? "bg-stone-900 text-white" : "bg-white"}`}>Nepriradené</Link></div>

      <p className="mb-4 rounded-[10px] bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {entity ? "Prehľad obsahuje iba doklady z vybraného filtra v EUR. eKasa a bankové platby zatiaľ nemajú priradený subjekt a nie sú v tomto súčte." : "Operatívny prehľad podľa dátumu dokladov. Párovaná eKasa sa k faktúre nepripočíta druhýkrát; nepárované rovnaké predaje môžu stále nadhodnotiť súčet. Prijaté doklady nie sú úplné náklady a peňažné toky vychádzajú len z evidovaných platieb."}
      </p>
      <div className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="Evidované predaje s DPH"
          value={formatCents(revenueThisMonth)}
          hint={entity ? "Iba priradené vydané doklady v EUR" : `Vydané doklady + nespárovaná eKasa; spárované ${formatCents(matchedEkasaThisMonth._sum.totalGrossCents ?? 0)} vylúčené`}
        />
        <KpiCard label="Vydané doklady s DPH" value={formatCents(issuedThisMonthCents)} hint={`${issuedDocuments.length} dokladov vrátane dobropisov`} />
        {!entity && <KpiCard label="eKasa bez párovania" value={formatCents(ekasaThisMonth._sum.totalGrossCents ?? 0)} hint="Môže obsahovať rovnaký predaj ako faktúra" />}
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
          label="Prijaté doklady spolu"
          value={formatCents(receivedThisMonthCents)}
          hint={`${receivedDocuments.length} prijatých dokladov v EUR; cudziu DPH nepovažovať za slovenský odpočet`}
        />
        {!entity && <KpiCard label="Prijaté platby" value={formatCents(cashIn._sum.amountCents ?? 0)} hint="Z evidovaných platieb, nie z vystavených dokladov" />}
        {!entity && <KpiCard label="Odoslané platby" value={formatCents(cashOut._sum.amountCents ?? 0)} hint="Z evidovaných platieb" />}
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
                  <th className="px-[18px] py-2 text-right font-medium">Predvolená B2B</th>
                  <th className="px-[18px] py-2 text-right font-medium">Marža B2B</th>
                  <th className="px-[18px] py-2 text-right font-medium">Cena B2C bez DPH v objednávke</th>
                  <th className="px-[18px] py-2 text-right font-medium">Marža B2C</th>
                </tr>
              </thead>
              <tbody>
                {margins.map((m) => (
                  <tr key={m.id} className={tr}>
                    <td className={`${td} font-medium`}>{m.name}</td>
                    <td className={tdRightMuted}>{formatCents(m.costPerUnitCents)}</td>
                    <td className={tdRight}>{m.priceB2bCents === null ? "Podľa klienta" : formatCents(m.priceB2bCents)}</td>
                    <td className={`px-[18px] py-[9px] text-right font-semibold tabular-nums ${m.marginB2bPct !== null && m.marginB2bPct < 30 ? "text-red-600" : "text-[#1F7A0F]"}`}>
                      {m.marginB2bPct === null ? "—" : `${m.marginB2bPct} %`}
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
