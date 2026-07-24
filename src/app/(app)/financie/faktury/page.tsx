import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import {
  Badge,
  INVOICE_DOCUMENT_STATUS_COLORS,
  INVOICE_PAYMENT_STATUS_COLORS,
} from "@/components/Badge";
import { formatCents, formatDate } from "@/lib/format";
import { INVOICE_SOURCE_LABELS } from "@/lib/invoicing";
import {
  invoiceDocumentStatusLabels,
  invoicePaymentStatusLabels,
} from "@/lib/zod-schemas";
import { calculatePaymentStatus } from "@/lib/finance/domain";
import { btnPrimary, btnSecondary, filterPill } from "@/components/ui";

const DIRECTION_LABELS: Record<string, string> = { VYDANA: "Vydané", PRIJATA: "Prijaté" };

export default async function FakturyPage({
  searchParams,
}: {
  searchParams: Promise<{ smer?: string; zdroj?: string; stav?: string }>;
}) {
  const { smer, zdroj, stav } = await searchParams;
  const smerFilter = smer === "VYDANA" || smer === "PRIJATA" ? smer : undefined;
  const zdrojFilter = zdroj && zdroj in INVOICE_SOURCE_LABELS ? zdroj : undefined;
  const stavFilter = stav && stav in invoiceDocumentStatusLabels ? stav : undefined;

  const invoices = await prisma.invoice.findMany({
    where: {
      ...(smerFilter ? { direction: smerFilter } : {}),
      ...(zdrojFilter ? { source: zdrojFilter } : {}),
      ...(stavFilter ? { documentStatus: stavFilter } : {}),
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
    const merged = { smer: smerFilter, zdroj: zdrojFilter, stav: stavFilter, ...patch };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    const qs = params.toString();
    return qs ? `/financie/faktury?${qs}` : "/financie/faktury";
  };

  const exportHref = () => {
    const params = new URLSearchParams();
    if (smerFilter) params.set("smer", smerFilter);
    if (zdrojFilter) params.set("zdroj", zdrojFilter);
    const qs = params.toString();
    return qs ? `/financie/export?${qs}` : "/financie/export";
  };

  const now = Date.now();

  return (
    <>
      <PageHeader title="Faktúry" subtitle="Jednotná evidencia ERP, webu a historických dokladov">
        <a href={exportHref()} className={btnSecondary} download>
          ⬇ Export CSV
        </a>
        <Link href="/financie/import" className={btnSecondary}>
          Import
        </Link>
        <Link href="/financie/faktury/nova" className={btnPrimary}>
          + Nová faktúra
        </Link>
      </PageHeader>

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
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={filterHref({ stav: undefined })} className={filterPill(!stavFilter)}>
          Všetky stavy
        </Link>
        {Object.entries(invoiceDocumentStatusLabels).map(([value, label]) => (
          <Link key={value} href={filterHref({ stav: value })} className={filterPill(stavFilter === value)}>
            {label}
          </Link>
        ))}
      </div>

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
            {invoices.map((inv) => {
              const allocatedCents = inv.paymentAllocations.reduce(
                (sum, allocation) => sum + allocation.amountCents,
                0,
              );
              const paymentStatus = calculatePaymentStatus(inv.totalGrossCents, allocatedCents);
              const overdue =
                inv.documentStatus === "ISSUED" &&
                (paymentStatus === "UNPAID" || paymentStatus === "PARTIALLY_PAID") &&
                inv.dueDate.getTime() < now;
              return (
                <tr key={inv.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <Link href={`/financie/faktury/${inv.id}`} className="font-medium text-stone-950 hover:underline">
                      {inv.invoiceNumber ?? "Koncept"}
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
                      <span className="text-stone-700">{inv.supplierName ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-600">{formatDate(inv.issueDate)}</td>
                  <td className={`px-4 py-3 ${overdue ? "font-medium text-red-600" : "text-stone-600"}`}>
                    {formatDate(inv.dueDate)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-stone-900">
                    {formatCents(inv.totalGrossCents)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={INVOICE_DOCUMENT_STATUS_COLORS[inv.documentStatus]}>
                      {invoiceDocumentStatusLabels[inv.documentStatus] ?? inv.documentStatus}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={overdue ? "red" : INVOICE_PAYMENT_STATUS_COLORS[paymentStatus]}>
                      {overdue ? "Po splatnosti" : invoicePaymentStatusLabels[paymentStatus]}
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
