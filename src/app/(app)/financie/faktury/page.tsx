import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import {
  Badge,
  INVOICE_DOCUMENT_STATUS_COLORS,
  INVOICE_PAYMENT_STATUS_COLORS,
} from "@/components/Badge";
import { formatCents, formatCurrencyMinor, formatDate } from "@/lib/format";
import { INVOICE_SOURCE_LABELS } from "@/lib/invoicing";
import {
  invoiceDocumentStatusLabels,
  invoicePaymentStatusLabels,
} from "@/lib/zod-schemas";
import { calculatePaymentStatus } from "@/lib/finance/domain";
import { btnPrimary, btnSecondary, filterPill } from "@/components/ui";
import { legalEntityLabels } from "@/lib/zod-schemas";

const DIRECTION_LABELS: Record<string, string> = { VYDANA: "Vydané", PRIJATA: "Prijaté" };

export default async function FakturyPage({
  searchParams,
}: {
  searchParams: Promise<{ smer?: string; zdroj?: string; stav?: string; subjekt?: string; q?: string; uhrada?: string; rok?: string }>;
}) {
  const { smer, zdroj, stav, subjekt, q, uhrada, rok } = await searchParams;
  const smerFilter = smer === "VYDANA" || smer === "PRIJATA" ? smer : undefined;
  const zdrojFilter = zdroj && zdroj in INVOICE_SOURCE_LABELS ? zdroj : undefined;
  const stavFilter = stav && stav in invoiceDocumentStatusLabels ? stav : undefined;
  const entityFilter = subjekt === "UNASSIGNED" || (subjekt && subjekt in legalEntityLabels) ? subjekt : undefined;
  const query = q?.trim().slice(0, 100) ?? "";
  const paymentFilter = uhrada === "PAID" || uhrada === "UNPAID" || uhrada === "OVERDUE" ? uhrada : undefined;
  const currentYear = new Date().getFullYear();
  const yearFilter = rok === String(currentYear) ? currentYear : undefined;

  const invoices = await prisma.invoice.findMany({
    where: {
      ...(smerFilter ? { direction: smerFilter } : {}),
      ...(zdrojFilter ? { source: zdrojFilter } : {}),
      ...(stavFilter ? { documentStatus: stavFilter } : {}),
      ...(entityFilter ? { legalEntity: entityFilter === "UNASSIGNED" ? null : entityFilter } : {}),
      ...(yearFilter ? { issueDate: { gte: new Date(Date.UTC(yearFilter, 0, 1)), lt: new Date(Date.UTC(yearFilter + 1, 0, 1)) } } : {}),
      ...(query ? { OR: [
        { invoiceNumber: { contains: query, mode: "insensitive" as const } },
        { externalNumber: { contains: query, mode: "insensitive" as const } },
        { variableSymbol: { contains: query, mode: "insensitive" as const } },
        { supplierName: { contains: query, mode: "insensitive" as const } },
        { client: { name: { contains: query, mode: "insensitive" as const } } },
      ] } : {}),
    },
    select: {
      id: true,
      invoiceNumber: true,
      externalNumber: true,
      source: true,
      direction: true,
      documentType: true,
      documentStatus: true,
      historicalKind: true,
      paymentConfirmation: true,
      supplierName: true,
      counterpartySnapshot: true,
      issueDate: true,
      dueDate: true,
      totalGrossCents: true,
      currency: true,
      client: { select: { id: true, name: true } },
      paymentAllocations: { where: { reversedAt: null }, select: { amountCents: true } },
    },
    orderBy: [{ issueDate: "desc" }, { invoiceNumber: "desc" }],
  });

  const filterHref = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { smer: smerFilter, zdroj: zdrojFilter, stav: stavFilter, subjekt: entityFilter, q: query || undefined, uhrada: paymentFilter, rok: yearFilter?.toString(), ...patch };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    const qs = params.toString();
    return qs ? `/financie/faktury?${qs}` : "/financie/faktury";
  };

  const exportHref = () => {
    const params = new URLSearchParams();
    if (smerFilter) params.set("smer", smerFilter);
    if (zdrojFilter) params.set("zdroj", zdrojFilter);
    if (entityFilter) params.set("subjekt", entityFilter);
    if (yearFilter) { params.set("od", `${yearFilter}-01-01`); params.set("do", `${yearFilter}-12-31`); }
    const qs = params.toString();
    return qs ? `/financie/export?${qs}` : "/financie/export";
  };

  const now = Date.now();
  const invoiceRows = invoices.map((invoice) => {
    const allocatedCents = invoice.paymentAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
    const paymentStatus = calculatePaymentStatus(invoice.totalGrossCents, allocatedCents);
    const overdue = invoice.source !== "HISTORICAL" && invoice.documentStatus === "ISSUED" &&
      (paymentStatus === "UNPAID" || paymentStatus === "PARTIALLY_PAID") && invoice.dueDate.getTime() < now;
    return { invoice, paymentStatus, overdue, remainingCents: Math.max(0, invoice.totalGrossCents - allocatedCents) };
  });
  const activeIssued = invoiceRows.filter(({ invoice }) => invoice.direction === "VYDANA" && invoice.documentType === "INVOICE" && invoice.documentStatus === "ISSUED" && invoice.source !== "HISTORICAL" && invoice.currency === "EUR");
  const unpaid = activeIssued.filter(({ remainingCents }) => remainingCents > 0);
  const overdue = unpaid.filter(({ overdue }) => overdue);
  const draftCount = invoiceRows.filter(({ invoice }) => invoice.documentStatus === "DRAFT").length;
  const unpaidCents = unpaid.reduce((sum, row) => sum + row.remainingCents, 0);
  const filteredRows = invoiceRows.filter(({ invoice, paymentStatus, overdue }) => {
    if (!paymentFilter) return true;
    if (invoice.documentStatus !== "ISSUED" || invoice.source === "HISTORICAL") return false;
    if (paymentFilter === "PAID") return paymentStatus === "PAID" || paymentStatus === "OVERPAID";
    if (paymentFilter === "OVERDUE") return overdue;
    return paymentStatus === "UNPAID" || paymentStatus === "PARTIALLY_PAID";
  });
  const visibleRows = filteredRows.slice(0, 200);

  return (
    <>
      <PageHeader title="Faktúry" subtitle="Jednotná evidencia ERP, webu a historických dokladov">
        <a href={exportHref()} className={btnSecondary} download title="Export finalizovaných dokladov pre účtovníka; vyhľadávanie a stav zoznamu sa naň nevzťahujú">
          ⬇ Účtovný export
        </a>
        <Link href="/financie/import" className={btnSecondary}>
          Import
        </Link>
        <Link href="/financie/faktury/nova" className={btnPrimary}>
          + Nová faktúra
        </Link>
        <Link href="/financie/faktury/historicka" className={btnSecondary}>+ Historický originál</Link>
      </PageHeader>

      <nav aria-label="Stav úhrady" className="mb-5 flex flex-wrap gap-1 border-b border-stone-200">
        {[
          { value: undefined, label: "Všetky" },
          { value: "PAID", label: "Uhradené" },
          { value: "UNPAID", label: "Neuhradené" },
          { value: "OVERDUE", label: "Po splatnosti" },
        ].map(({ value, label }) => (
          <Link key={label} href={filterHref({ uhrada: value })} aria-current={paymentFilter === value ? "page" : undefined} className={`border-b-[3px] px-4 py-2.5 text-sm font-semibold transition ${paymentFilter === value ? "border-brand text-stone-950" : "border-transparent text-stone-500 hover:text-stone-900"}`}>{label}</Link>
        ))}
      </nav>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[14px] border border-stone-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Na úhradu</p>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums text-stone-950">{formatCents(unpaidCents)}</p>
          <p className="mt-1 text-xs text-stone-500">{unpaid.length} vydaných faktúr v EUR</p>
        </div>
        <div className="rounded-[14px] border border-stone-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Po splatnosti</p>
          <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${overdue.length ? "text-red-700" : "text-stone-950"}`}>{overdue.length}</p>
          <p className="mt-1 text-xs text-stone-500">vydaných faktúr na preverenie</p>
        </div>
        <div className="rounded-[14px] border border-stone-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Koncepty</p>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums text-stone-950">{draftCount}</p>
          <p className="mt-1 text-xs text-stone-500">čakajú na dokončenie</p>
        </div>
      </div>

      <div className="mb-5 rounded-[14px] border border-stone-200 bg-white p-4">
        <form action="/financie/faktury" className="mb-4 flex flex-wrap items-end gap-2">
          {smerFilter && <input type="hidden" name="smer" value={smerFilter} />}
          {zdrojFilter && <input type="hidden" name="zdroj" value={zdrojFilter} />}
          {stavFilter && <input type="hidden" name="stav" value={stavFilter} />}
          {entityFilter && <input type="hidden" name="subjekt" value={entityFilter} />}
          {paymentFilter && <input type="hidden" name="uhrada" value={paymentFilter} />}
          {yearFilter && <input type="hidden" name="rok" value={yearFilter} />}
          <div className="min-w-[220px] flex-1">
            <label htmlFor="invoice-search" className="mb-1.5 block text-xs font-semibold text-stone-700">Hľadať faktúru</label>
            <input id="invoice-search" type="search" name="q" defaultValue={query} placeholder="Číslo, VS, klient alebo dodávateľ" className="w-full rounded-[10px] border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-950 focus:ring-[3px] focus:ring-brand/35" />
          </div>
          <button type="submit" className={btnSecondary}>Hľadať</button>
          {query && <Link href={filterHref({ q: undefined })} className={btnSecondary}>Vymazať</Link>}
        </form>
        <div className="mb-3 flex gap-2 border-b border-stone-100 pb-3">
          <Link href={filterHref({ rok: undefined })} className={filterPill(!yearFilter)}>Všetky roky</Link>
          <Link href={filterHref({ rok: String(currentYear) })} className={filterPill(Boolean(yearFilter))}>Tento rok</Link>
        </div>
        <div className="mb-2 flex flex-wrap gap-2">
        <Link href={filterHref({ smer: undefined })} className={filterPill(!smerFilter)}>
          Všetky smery
        </Link>
        {Object.entries(DIRECTION_LABELS).map(([value, label]) => (
          <Link key={value} href={filterHref({ smer: value })} className={filterPill(smerFilter === value)}>
            {label}
          </Link>
        ))}
        <span className="mx-1 self-center text-stone-300">·</span>
        <Link href={filterHref({ zdroj: undefined })} className={filterPill(!zdrojFilter)}>
          Všetky zdroje
        </Link>
        {Object.entries(INVOICE_SOURCE_LABELS).map(([value, label]) => (
          <Link key={value} href={filterHref({ zdroj: value })} className={filterPill(zdrojFilter === value)}>
            {label}
          </Link>
        ))}
        </div>
        <div className="flex flex-wrap gap-2">
        <Link href={filterHref({ subjekt: undefined })} className={filterPill(!entityFilter)}>Všetky subjekty</Link>
        {Object.entries(legalEntityLabels).map(([value, title]) => <Link key={value} href={filterHref({ subjekt: value })} className={filterPill(entityFilter === value)}>{title}</Link>)}
        <Link href={filterHref({ subjekt: "UNASSIGNED" })} className={filterPill(entityFilter === "UNASSIGNED")}>Nepriradené</Link>
        <Link href={filterHref({ stav: undefined })} className={filterPill(!stavFilter)}>
          Všetky stavy
        </Link>
        {Object.entries(invoiceDocumentStatusLabels).map(([value, label]) => (
          <Link key={value} href={filterHref({ stav: value })} className={filterPill(stavFilter === value)}>
            {label}
          </Link>
        ))}
        </div>
      </div>

      <p className="mb-2 text-xs text-stone-500">Zobrazených {visibleRows.length} z {filteredRows.length} dokladov. Súhrn vyššie zohľadňuje ostatné zvolené filtre a všetky zodpovedajúce doklady.</p>

      <div className="overflow-x-auto rounded-[14px] border border-stone-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
              <th className="px-4 py-3">Číslo faktúry</th>
              <th className="px-4 py-3">Doklad</th>
              <th className="px-4 py-3">Klient / dodávateľ</th>
              <th className="px-4 py-3 text-right">Suma</th>
              <th className="px-4 py-3">Vystavená / splatná</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-stone-400">
                  Žiadne faktúry nezodpovedajú filtru.
                </td>
              </tr>
            )}
            {visibleRows.map(({ invoice: inv, paymentStatus, overdue }) => {
              return (
                <tr key={inv.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <Link href={`/financie/faktury/${inv.id}`} className="font-medium text-stone-950 hover:underline">
                      {inv.invoiceNumber ?? (inv.source === "HISTORICAL" ? inv.externalNumber ?? "Historický originál" : "Koncept")}
                    </Link>
                    {inv.externalNumber && inv.externalNumber !== inv.invoiceNumber && <div className="mt-0.5 text-xs text-stone-500">Externé č. {inv.externalNumber}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-stone-900">{inv.documentType === "CREDIT_NOTE" ? "Dobropis" : inv.source === "HISTORICAL" && inv.historicalKind === "PROFORMA" ? "Predfaktúra" : inv.direction === "PRIJATA" ? "Prijatá faktúra" : "Vydaná faktúra"}</span>
                    <div className="mt-1 flex flex-wrap gap-1.5"><Badge color={INVOICE_DOCUMENT_STATUS_COLORS[inv.documentStatus]}>
                      {inv.source === "HISTORICAL" ? "Pôvodný doklad" : invoiceDocumentStatusLabels[inv.documentStatus] ?? inv.documentStatus}
                    </Badge>
                    <Badge color={inv.source === "INTERNA" ? "gray" : "yellow"}>{INVOICE_SOURCE_LABELS[inv.source] ?? inv.source}</Badge></div>
                  </td>
                  <td className="px-4 py-3">
                    {inv.client ? (
                      <Link href={`/klienti/${inv.client.id}`} className="text-stone-700 hover:underline">
                        {inv.client.name}
                      </Link>
                    ) : (
                      <span className="text-stone-700">{inv.supplierName ?? (inv.counterpartySnapshot && typeof inv.counterpartySnapshot === "object" && "name" in inv.counterpartySnapshot ? String(inv.counterpartySnapshot.name) : "—")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-stone-900">
                    {formatCurrencyMinor(inv.totalGrossCents, inv.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="mb-1 text-stone-700">{formatDate(inv.issueDate)} / <span className={overdue ? "font-semibold text-red-700" : ""}>{formatDate(inv.dueDate)}</span></div>
                    <Badge color={overdue ? "red" : INVOICE_PAYMENT_STATUS_COLORS[paymentStatus]}>
                      {inv.source === "HISTORICAL" ? inv.paymentConfirmation ? "Potvrdená mimo ERP" : "Neoverená" : overdue ? "Po splatnosti" : invoicePaymentStatusLabels[paymentStatus]}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
