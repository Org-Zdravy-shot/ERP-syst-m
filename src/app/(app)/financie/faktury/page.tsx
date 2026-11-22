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
import { btnPrimary, btnSecondary, input, label } from "@/components/ui";
import { slovakDateKey } from "../../objednavky/pricing";
import { parseInvoiceFilters, invoiceListHref, invoiceListParams, overviewInvoiceScope } from "./list-filters";

const PAGE_SIZE = 50;

const DIRECTION_LABELS: Record<string, string> = { VYDANA: "Vydané", PRIJATA: "Prijaté" };

export default async function FakturyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const today = slovakDateKey();
  const currentYear = Number(today.slice(0, 4));
  const filters = parseInvoiceFilters(await searchParams, currentYear);
  const {
    smer: smerFilter, zdroj: zdrojFilter, stav: stavFilter, subjekt: entityFilter,
    q: query, uhrada: paymentFilter, typ: typeFilter, rozsah: reportScope,
  } = filters;
  const yearFilter = filters.rok ? Number(filters.rok) : undefined;
  const expenses = smerFilter === "PRIJATA";

  // Keep the full scan limited to amounts and payment state. Fetch display
  // fields only for the selected page, after applying the payment filter.
  const candidates = await prisma.invoice.findMany({
    where: {
      ...(smerFilter ? { direction: smerFilter } : {}),
      ...(zdrojFilter ? { source: zdrojFilter } : {}),
      ...(stavFilter ? { documentStatus: stavFilter } : {}),
      ...(typeFilter ? { documentType: typeFilter } : {}),
      ...(entityFilter ? { legalEntity: entityFilter === "UNASSIGNED" ? null : entityFilter } : {}),
      ...(yearFilter ? { issueDate: { gte: new Date(Date.UTC(yearFilter, 0, 1)), lt: new Date(Date.UTC(yearFilter + 1, 0, 1)) } } : {}),
      AND: [
        ...(reportScope ? [overviewInvoiceScope] : []),
        ...(query ? [{
          OR: [
            { invoiceNumber: { contains: query, mode: "insensitive" as const } },
            { externalNumber: { contains: query, mode: "insensitive" as const } },
            { variableSymbol: { contains: query, mode: "insensitive" as const } },
            { supplierName: { contains: query, mode: "insensitive" as const } },
            { client: { name: { contains: query, mode: "insensitive" as const } } },
          ],
        }] : []),
      ],
    },
    select: {
      id: true,
      source: true,
      direction: true,
      documentType: true,
      documentStatus: true,
      dueDate: true,
      totalGrossCents: true,
      currency: true,
      paymentAllocations: { where: { reversedAt: null }, select: { amountCents: true } },
    },
    orderBy: [{ issueDate: "desc" }, { invoiceNumber: "desc" }, { id: "desc" }],
  });

  const filterHref = (patch: Record<string, string | undefined>) =>
    invoiceListHref({ ...filters, strana: undefined, ...patch });

  const exportHref = () => {
    const params = new URLSearchParams();
    if (smerFilter) params.set("smer", smerFilter);
    if (zdrojFilter) params.set("zdroj", zdrojFilter);
    if (entityFilter) params.set("subjekt", entityFilter);
    if (yearFilter) { params.set("od", `${yearFilter}-01-01`); params.set("do", `${yearFilter}-12-31`); }
    const qs = params.toString();
    return qs ? `/financie/export?${qs}` : "/financie/export";
  };

  const invoiceRows = candidates.map((invoice) => {
    const allocatedCents = invoice.paymentAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
    const remainingCents = Math.max(0, invoice.totalGrossCents - allocatedCents);
    const paymentEligible = invoice.documentType === "INVOICE" &&
      invoice.source !== "HISTORICAL" && invoice.documentStatus === "ISSUED";
    const overdue = paymentEligible && remainingCents > 0 && invoice.dueDate.toISOString().slice(0, 10) < today;
    const paymentStatus = paymentEligible ? calculatePaymentStatus(invoice.totalGrossCents, allocatedCents) : null;
    return { invoice, paymentEligible, paymentStatus, overdue, remainingCents };
  });
  const filteredRows = invoiceRows.filter((row) => {
    if (!paymentFilter) return true;
    if (!row.paymentEligible) return false;
    if (paymentFilter === "PAID") return row.paymentStatus === "PAID" || row.paymentStatus === "OVERPAID";
    if (paymentFilter === "OVERDUE") return row.overdue;
    return row.remainingCents > 0;
  });
  const outstanding = filteredRows.filter(({ invoice, paymentEligible, remainingCents }) =>
    paymentEligible && (!smerFilter ? invoice.direction === "VYDANA" : true) &&
    invoice.currency === "EUR" && remainingCents > 0,
  );
  const overdue = outstanding.filter((row) => row.overdue);
  const draftCount = filteredRows.filter(({ invoice }) =>
    invoice.documentStatus === "DRAFT" && invoice.source !== "HISTORICAL",
  ).length;
  const unpaidCents = outstanding.reduce((sum, row) => sum + row.remainingCents, 0);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const page = Math.min(Number(filters.strana ?? 1), pageCount);
  const offset = (page - 1) * PAGE_SIZE;
  const pageRows = filteredRows.slice(offset, offset + PAGE_SIZE);
  const pageDetails = pageRows.length ? await prisma.invoice.findMany({
    where: { id: { in: pageRows.map(({ invoice }) => invoice.id) } },
    select: {
      id: true,
      invoiceNumber: true,
      externalNumber: true,
      historicalKind: true,
      paymentConfirmation: true,
      supplierName: true,
      counterpartySnapshot: true,
      issueDate: true,
      client: { select: { id: true, name: true } },
    },
  }) : [];
  const detailsById = new Map(pageDetails.map((invoice) => [invoice.id, invoice]));
  const visibleRows = pageRows.flatMap((row) => {
    const details = detailsById.get(row.invoice.id);
    return details ? [{ ...row, invoice: { ...row.invoice, ...details } }] : [];
  });
  const listContext = invoiceListParams({ ...filters, strana: page > 1 ? String(page) : undefined });
  const pageHref = (target: number) => filterHref({ strana: target > 1 ? String(target) : undefined });

  return (
    <>
      <PageHeader title={expenses ? "Náklady" : "Faktúry"} subtitle={expenses ? "Prijaté doklady a ich úhrady" : smerFilter === "VYDANA" ? "Vydané doklady, koncepty a úhrady" : "Vydané a prijaté doklady, koncepty a úhrady"}>
        <a href={exportHref()} className={btnSecondary} download title="Export finalizovaných dokladov pre účtovníka; vyhľadávanie a stav zoznamu sa naň nevzťahujú">
          ⬇ Účtovný export
        </a>
        <Link href="/financie/import" className={btnSecondary}>
          Historická migrácia
        </Link>
        {smerFilter === "PRIJATA" ? (
          <Link href="/financie/faktury/historicka?smer=PRIJATA" className={btnPrimary}>+ Historický doklad</Link>
        ) : (
          <>
            <Link href={entityFilter ? `/financie/faktury/nova?subjekt=${entityFilter}` : "/financie/faktury/nova"} className={btnPrimary}>+ Nová faktúra</Link>
            <Link href="/financie/faktury/historicka" className={btnSecondary}>+ Historický doklad</Link>
            <Link href={entityFilter ? `/financie/faktury/suhrnna?subjekt=${entityFilter}` : "/financie/faktury/suhrnna"} className={btnSecondary}>+ Súhrnná faktúra</Link>
          </>
        )}
      </PageHeader>

      <nav className="finance-document-tabs" aria-label="Druhy dokladov">
        <Link href={filterHref({ typ: undefined, stav: undefined, rozsah: undefined })} aria-current={!typeFilter && !stavFilter && !reportScope ? "page" : undefined}>Všetky doklady</Link>
        <Link href={filterHref({ typ: "INVOICE", stav: "ISSUED", rozsah: undefined })} aria-current={typeFilter === "INVOICE" && stavFilter === "ISSUED" ? "page" : undefined}>Faktúry</Link>
        <Link href={filterHref({ typ: "CREDIT_NOTE", stav: undefined, rozsah: undefined, uhrada: undefined })} aria-current={typeFilter === "CREDIT_NOTE" ? "page" : undefined}>Dobropisy</Link>
        <Link href={filterHref({ typ: undefined, stav: "DRAFT", rozsah: undefined, uhrada: undefined })} aria-current={stavFilter === "DRAFT" ? "page" : undefined}>Koncepty</Link>
        <Link href={filterHref({ typ: undefined, stav: "CANCELLED", rozsah: undefined, uhrada: undefined })} aria-current={stavFilter === "CANCELLED" ? "page" : undefined}>Stornované</Link>
      </nav>


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
          <p className="mt-1 text-xs text-stone-500">{outstanding.length} {expenses ? "prijatých" : "vydaných"} faktúr v EUR</p>
        </div>
        <div className="rounded-[14px] border border-stone-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Po splatnosti</p>
          <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${overdue.length ? "text-red-700" : "text-stone-950"}`}>{overdue.length}</p>
          <p className="mt-1 text-xs text-stone-500">{expenses ? "prijatých" : "vydaných"} faktúr v EUR</p>
        </div>
        <div className="rounded-[14px] border border-stone-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Koncepty</p>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums text-stone-950">{draftCount}</p>
          <p className="mt-1 text-xs text-stone-500">čakajú na dokončenie</p>
        </div>
      </div>

      <div className="finance-list-layout">
      <aside className="finance-list-filters">
        <form action="/financie/faktury" key={listContext.toString()}>
          {entityFilter && <input type="hidden" name="subjekt" value={entityFilter} />}
          {paymentFilter && <input type="hidden" name="uhrada" value={paymentFilter} />}
          {stavFilter && <input type="hidden" name="stav" value={stavFilter} />}
          {typeFilter && <input type="hidden" name="typ" value={typeFilter} />}
          {reportScope && <input type="hidden" name="rozsah" value={reportScope} />}
          <div>
            <label htmlFor="invoice-search" className={label}>Hľadať doklad</label>
            <input id="invoice-search" type="search" name="q" defaultValue={query ?? ""} maxLength={100} placeholder="Číslo, firma alebo VS" className={input} />
          </div>
          <div>
            <label htmlFor="invoice-year" className={label}>Rok vystavenia</label>
            <select id="invoice-year" name="rok" defaultValue={filters.rok ?? ""} className={input}>
              <option value="">Všetky roky</option>
              {Array.from({ length: currentYear - 2008 }, (_, index) => currentYear + 1 - index).map(year =>
                <option value={year} key={year}>{year}</option>
              )}
            </select>
          </div>
          <div>
            <label htmlFor="invoice-direction" className={label}>Smer</label>
            <select id="invoice-direction" name="smer" defaultValue={smerFilter ?? ""} className={input}>
              <option value="">Všetky smery</option>
              {Object.entries(DIRECTION_LABELS).map(([value, title]) => <option value={value} key={value}>{title}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="invoice-source" className={label}>Zdroj</label>
            <select id="invoice-source" name="zdroj" defaultValue={zdrojFilter ?? ""} className={input}>
              <option value="">Všetky zdroje</option>
              {Object.entries(INVOICE_SOURCE_LABELS).map(([value, title]) => <option value={value} key={value}>{title}</option>)}
            </select>
          </div>
          <div className="finance-filter-actions">
            <button type="submit" className={btnSecondary}>Použiť filtre</button>
            <Link href={invoiceListHref({ smer: smerFilter, subjekt: entityFilter })} className="underline">Zrušiť filtre</Link>
          </div>
        </form>
      </aside>

      <div className="finance-list-results">
      <p className="mb-2 text-xs text-stone-600">
        {filteredRows.length ? `${offset + 1}–${offset + visibleRows.length} z ${filteredRows.length} dokladov` : "0 dokladov"}
        {reportScope && " · Rozsah prehľadu: vystavené doklady v EUR bez predfaktúr"}
      </p>

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
            {visibleRows.map(({ invoice: inv, paymentStatus, overdue, remainingCents }) => {
              const displayedNumber = inv.invoiceNumber ?? inv.externalNumber ?? (inv.documentStatus === "DRAFT" ? "Koncept" : "Bez čísla");
              return (
                <tr key={inv.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <Link href={`/financie/faktury/${inv.id}?${new URLSearchParams({ smer: inv.direction, ...(entityFilter ? { subjekt: entityFilter } : {}), zoznam: listContext.toString() })}`} className="font-medium text-stone-950 hover:underline">
                      {displayedNumber}
                    </Link>
                    {inv.externalNumber && inv.externalNumber !== displayedNumber && <div className="mt-0.5 text-xs text-stone-500">Externé č. {inv.externalNumber}</div>}
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
                    {paymentStatus === "PARTIALLY_PAID" && <div className="mt-1 text-xs font-normal text-stone-600">Zostáva {formatCurrencyMinor(remainingCents, inv.currency)}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="mb-1 text-stone-700">{formatDate(inv.issueDate)} / <span className={overdue ? "font-semibold text-red-700" : ""}>{formatDate(inv.dueDate)}</span></div>
                    {inv.source === "HISTORICAL" ? (
                      <Badge color="gray">{inv.paymentConfirmation ? "Potvrdená mimo ERP" : "Neoverená"}</Badge>
                    ) : paymentStatus && (
                      <Badge color={overdue ? "red" : INVOICE_PAYMENT_STATUS_COLORS[paymentStatus]}>
                        {overdue ? "Po splatnosti" : invoicePaymentStatusLabels[paymentStatus]}
                      </Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <nav aria-label="Stránky dokladov" className="finance-pagination">
          {page > 1 && <Link href={pageHref(page - 1)} className={btnSecondary}>← Predchádzajúca</Link>}
          <span>Strana {page} z {pageCount}</span>
          {page < pageCount && <Link href={pageHref(page + 1)} className={btnSecondary}>Nasledujúca →</Link>}
        </nav>
      )}
      </div></div>
    </>
  );
}
