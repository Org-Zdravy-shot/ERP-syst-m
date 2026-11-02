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
  searchParams: Promise<{ smer?: string; zdroj?: string; stav?: string; subjekt?: string; q?: string }>;
}) {
  const { smer, zdroj, stav, subjekt, q } = await searchParams;
  const smerFilter = smer === "VYDANA" || smer === "PRIJATA" ? smer : undefined;
  const zdrojFilter = zdroj && zdroj in INVOICE_SOURCE_LABELS ? zdroj : undefined;
  const stavFilter = stav && stav in invoiceDocumentStatusLabels ? stav : undefined;
  const entityFilter = subjekt === "UNASSIGNED" || (subjekt && subjekt in legalEntityLabels) ? subjekt : undefined;
  const query = q?.trim().slice(0, 100) ?? "";

  const invoices = await prisma.invoice.findMany({
    where: {
      ...(smerFilter ? { direction: smerFilter } : {}),
      ...(zdrojFilter ? { source: zdrojFilter } : {}),
      ...(stavFilter ? { documentStatus: stavFilter } : {}),
      ...(entityFilter ? { legalEntity: entityFilter === "UNASSIGNED" ? null : entityFilter } : {}),
      ...(query ? { OR: [
        { invoiceNumber: { contains: query, mode: "insensitive" as const } },
        { externalNumber: { contains: query, mode: "insensitive" as const } },
        { variableSymbol: { contains: query, mode: "insensitive" as const } },
        { supplierName: { contains: query, mode: "insensitive" as const } },
        { client: { name: { contains: query, mode: "insensitive" as const } } },
      ] } : {}),
    },
    include: {
      client: true,
      paymentAllocations: { where: { reversedAt: null }, select: { amountCents: true } },
      order: { select: { id: true, orderNumber: true } },
    },
    orderBy: [{ issueDate: "desc" }, { invoiceNumber: "desc" }],
    take: 200,
  });

  const filterHref = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { smer: smerFilter, zdroj: zdrojFilter, stav: stavFilter, subjekt: entityFilter, q: query || undefined, ...patch };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    const qs = params.toString();
    return qs ? `/financie/faktury?${qs}` : "/financie/faktury";
  };

  const exportHref = () => {
    const params = new URLSearchParams();
    if (smerFilter) params.set("smer", smerFilter);
    if (zdrojFilter) params.set("zdroj", zdrojFilter);
    if (entityFilter) params.set("subjekt", entityFilter);
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
          <div className="min-w-[220px] flex-1">
            <label htmlFor="invoice-search" className="mb-1.5 block text-xs font-semibold text-stone-700">Hľadať faktúru</label>
            <input id="invoice-search" type="search" name="q" defaultValue={query} placeholder="Číslo, VS, klient alebo dodávateľ" className="w-full rounded-[10px] border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-950 focus:ring-[3px] focus:ring-brand/35" />
          </div>
          <button type="submit" className={btnSecondary}>Hľadať</button>
          {query && <Link href={filterHref({ q: undefined })} className={btnSecondary}>Vymazať</Link>}
        </form>
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

      <p className="mb-2 text-xs text-stone-500">Zobrazených {invoiceRows.length} najnovších dokladov{invoiceRows.length === 200 ? " (limit 200)" : ""}. Súhrn vyššie sa počíta len zo zobrazených dokladov podľa aktuálneho filtra.</p>

      <div className="overflow-x-auto rounded-[14px] border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
              <th className="px-4 py-3">Číslo</th>
              <th className="px-4 py-3">Externé číslo</th>
              <th className="px-4 py-3">Zdroj</th>
              <th className="px-4 py-3">Klient / dodávateľ</th>
              <th className="px-4 py-3">Vystavená</th>
              <th className="px-4 py-3">Splatná</th>
              <th className="px-4 py-3 text-right">Spolu s DPH</th>
              <th className="px-4 py-3">Doklad</th>
              <th className="px-4 py-3">Úhrada</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-stone-400">
                  Žiadne faktúry nezodpovedajú filtru.
                </td>
              </tr>
            )}
            {invoiceRows.map(({ invoice: inv, paymentStatus, overdue }) => {
              return (
                <tr key={inv.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <Link href={`/financie/faktury/${inv.id}`} className="font-medium text-stone-950 hover:underline">
                      {inv.invoiceNumber ?? (inv.source === "HISTORICAL" ? inv.externalNumber ?? "Historický originál" : "Koncept")}
                    </Link>
                    {inv.direction === "PRIJATA" && (
                      <span className="ml-1.5 text-xs text-stone-400">(prijatá)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-600">{inv.externalNumber ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge color={inv.source === "INTERNA" ? "gray" : "yellow"}>
                      {INVOICE_SOURCE_LABELS[inv.source] ?? inv.source}
                    </Badge>
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
                  <td className="px-4 py-3 text-stone-600">{formatDate(inv.issueDate)}</td>
                  <td className={`px-4 py-3 ${overdue ? "font-medium text-red-600" : "text-stone-600"}`}>
                    {formatDate(inv.dueDate)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-stone-900">
                    {formatCurrencyMinor(inv.totalGrossCents, inv.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={INVOICE_DOCUMENT_STATUS_COLORS[inv.documentStatus]}>
                      {inv.source === "HISTORICAL" ? inv.historicalKind === "PROFORMA" ? "Predfaktúra" : "Pôvodná faktúra" : invoiceDocumentStatusLabels[inv.documentStatus] ?? inv.documentStatus}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
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
