import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { bratislavaDateTimeToIso } from "@/lib/datetime";
import { slovakDateKey } from "../../objednavky/pricing";
import { formatCents, formatDate, MONTH_NAMES_SK } from "@/lib/format";
import { btnSecondary, card, cardHeader, table, thead, tr, td, tdRight } from "@/components/ui";

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export default async function CashflowPage() {
  const todayKey = slovakDateKey();
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const monthStart = new Date(Date.UTC(year, month - 5, 1));
  const sixMonthsAgo = new Date(bratislavaDateTimeToIso(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const nextMonth = new Date(Date.UTC(year, month + 1, 1));
  const endOfWindow = new Date(bratislavaDateTimeToIso(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 1));
  const in30Days = new Date(Date.UTC(year, month, today.getUTCDate() + 30));
  const openScope = {
    documentType: "INVOICE",
    documentStatus: "ISSUED",
    currency: "EUR",
    source: { not: "HISTORICAL" },
  };

  const [payments, openInvoices, dueSoon] = await Promise.all([
    prisma.payment.findMany({
      where: { currency: "EUR", paidAt: { gte: sixMonthsAgo, lt: endOfWindow } },
      select: { direction: true, amountCents: true, paidAt: true },
    }),
    prisma.invoice.findMany({
      where: {
        direction: "VYDANA",
        ...openScope,
      },
      include: {
        client: { select: { id: true, name: true } },
        paymentAllocations: { where: { reversedAt: null }, select: { amountCents: true } },
      },
      orderBy: { dueDate: "asc" },
    }),
    prisma.invoice.findMany({
      where: {
        direction: "PRIJATA",
        ...openScope,
        dueDate: { gte: today, lte: in30Days },
      },
      select: {
        totalGrossCents: true,
        paymentAllocations: { where: { reversedAt: null }, select: { amountCents: true } },
      },
    }),
  ]);

  // Cash-flow po mesiacoch (posledných 6)
  const months: Array<{ key: string; label: string; inCents: number; outCents: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - i, 1));
    months.push({
      key: monthKey(d),
      label: `${MONTH_NAMES_SK[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      inCents: 0,
      outCents: 0,
    });
  }
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const payment of payments) {
    const bucket = byKey.get(slovakDateKey(payment.paidAt).slice(0, 7));
    if (!bucket) continue;
    if (payment.direction === "INCOMING") bucket.inCents += payment.amountCents;
    else bucket.outCents += payment.amountCents;
  }
  const maxFlow = Math.max(1, ...months.map((m) => Math.max(m.inCents, m.outCents)));

  // Neuhradené vydané faktúry + aging
  const unpaid = openInvoices
    .map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientId: inv.client?.id,
      clientName: inv.client?.name ?? "—",
      dueDate: inv.dueDate,
      outstandingCents:
        inv.totalGrossCents - inv.paymentAllocations.reduce((sum, a) => sum + a.amountCents, 0),
    }))
    .filter((inv) => inv.outstandingCents > 0);

  const aging = { current: 0, d1to14: 0, d15to30: 0, d30plus: 0 };
  for (const inv of unpaid) {
    const overdueDays = Math.floor((today.getTime() - new Date(inv.dueDate.toISOString().slice(0, 10)).getTime()) / 86_400_000);
    if (overdueDays <= 0) aging.current += inv.outstandingCents;
    else if (overdueDays <= 14) aging.d1to14 += inv.outstandingCents;
    else if (overdueDays <= 30) aging.d15to30 += inv.outstandingCents;
    else aging.d30plus += inv.outstandingCents;
  }
  const totalUnpaid = unpaid.reduce((sum, inv) => sum + inv.outstandingCents, 0);
  const dueSoonCents = dueSoon.reduce(
    (sum, invoice) =>
      sum +
      Math.max(
        0,
        invoice.totalGrossCents -
          invoice.paymentAllocations.reduce((allocated, allocation) => allocated + allocation.amountCents, 0),
      ),
    0,
  );

  const agingCards = [
    { label: "Do splatnosti", value: aging.current, tone: "text-stone-950" },
    { label: "1–14 dní po", value: aging.d1to14, tone: "text-[#8A6200]" },
    { label: "15–30 dní po", value: aging.d15to30, tone: "text-[#B45309]" },
    { label: "Nad 30 dní po", value: aging.d30plus, tone: "text-[#B91C1C]" },
  ];

  return (
    <>
      <PageHeader
        title="Cash-flow"
        subtitle="Platby, očakávané príjmy a neuhradené faktúry v EUR za všetky subjekty"
      >
        <Link href="/financie/banka" className={btnSecondary}>
          Banka
        </Link>
      </PageHeader>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[14px] border border-stone-200 border-t-[3px] border-t-brand bg-white px-5 py-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            Neuhradené vydané
          </div>
          <div className="mt-2 font-display text-[22px] font-bold text-stone-950">
            {formatCents(totalUnpaid)}
          </div>
          <div className="mt-1 text-xs text-stone-400">{unpaid.length} faktúr</div>
        </div>
        <div className="rounded-[14px] border border-stone-200 border-t-[3px] border-t-brand bg-white px-5 py-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            Očakávané výdavky (30 dní)
          </div>
          <div className="mt-2 font-display text-[22px] font-bold text-stone-950">
            {formatCents(dueSoonCents)}
          </div>
          <div className="mt-1 text-xs text-stone-400">neuhradené prijaté so splatnosťou do 30 dní</div>
        </div>
        <div className="rounded-[14px] border border-stone-200 border-t-[3px] border-t-brand bg-white px-5 py-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            Prijaté tento mesiac
          </div>
          <div className="mt-2 font-display text-[22px] font-bold text-[#1F7A0F]">
            +{formatCents(months[months.length - 1].inCents)}
          </div>
          <div className="mt-1 text-xs text-stone-400">z bankových platieb</div>
        </div>
        <div className="rounded-[14px] border border-stone-200 border-t-[3px] border-t-brand bg-white px-5 py-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            Odoslané tento mesiac
          </div>
          <div className="mt-2 font-display text-[22px] font-bold text-[#B91C1C]">
            −{formatCents(months[months.length - 1].outCents)}
          </div>
          <div className="mt-1 text-xs text-stone-400">z bankových platieb</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className={card}>
          <div className={cardHeader}>Mesačné toky (posledných 6 mesiacov)</div>
          <div className="space-y-3 p-5">
            {months.map((month) => (
              <div key={month.key}>
                <div className="mb-1 flex justify-between text-xs text-stone-500">
                  <span>{month.label}</span>
                  <span className="tabular-nums">
                    <span className="text-[#1F7A0F]">+{formatCents(month.inCents)}</span>
                    {" · "}
                    <span className="text-[#B91C1C]">−{formatCents(month.outCents)}</span>
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full bg-[#2DA815]"
                      style={{ width: `${(month.inCents / maxFlow) * 100}%` }}
                    />
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full bg-[#B91C1C]"
                      style={{ width: `${(month.outCents / maxFlow) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {agingCards.map((bucket) => (
              <div key={bucket.label} className="rounded-[14px] border border-stone-200 bg-white px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                  {bucket.label}
                </div>
                <div className={`mt-1 text-sm font-bold tabular-nums ${bucket.tone}`}>
                  {formatCents(bucket.value)}
                </div>
              </div>
            ))}
          </div>

          <div className={card}>
            <div className={cardHeader}>Neuhradené faktúry</div>
            <div className="max-h-96 overflow-auto">
              <table className={table}>
                <thead>
                  <tr className={thead}>
                    <th className="px-[18px] py-2 font-medium">Faktúra</th>
                    <th className="px-[18px] py-2 font-medium">Klient</th>
                    <th className="px-[18px] py-2 font-medium">Splatnosť</th>
                    <th className="px-[18px] py-2 text-right font-medium">Zostáva</th>
                  </tr>
                </thead>
                <tbody>
                  {unpaid.map((inv) => {
                    const overdue = inv.dueDate.toISOString().slice(0, 10) < todayKey;
                    return (
                      <tr key={inv.id} className={tr}>
                        <td className={td}>
                          <Link href={`/financie/faktury/${inv.id}`} className="font-medium hover:underline">
                            {inv.invoiceNumber ?? "koncept"}
                          </Link>
                        </td>
                        <td className="px-[18px] py-[9px] text-stone-700">{inv.clientName}</td>
                        <td className={`whitespace-nowrap px-[18px] py-[9px] ${overdue ? "font-medium text-[#B91C1C]" : "text-stone-500"}`}>
                          {formatDate(inv.dueDate)}
                        </td>
                        <td className={tdRight}>{formatCents(inv.outstandingCents)}</td>
                      </tr>
                    );
                  })}
                  {unpaid.length === 0 && (
                    <tr className={tr}>
                      <td colSpan={4} className="px-[18px] py-8 text-center text-stone-400">
                        Žiadne neuhradené vydané faktúry v tomto prehľade.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
