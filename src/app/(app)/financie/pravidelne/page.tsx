import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary, card } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { hasFinancePermission, requireFinancePermission } from "@/lib/finance/permissions";
import { todaySlovakia } from "@/lib/finance/recurring/schedule";
import { formatDate } from "@/lib/format";
import { ScheduleActions } from "./ScheduleActions";

export default async function RecurringPage() {
  const actor = await requireFinancePermission("VIEW");
  const canCreate = hasFinancePermission(actor.role, "CREATE_DRAFT");
  const schedules = await prisma.recurringInvoiceSchedule.findMany({
    orderBy: { createdAt: "desc" }, take: 100,
    include: {
      sourceInvoice: { select: { id: true, invoiceNumber: true, client: { select: { name: true } } } },
      runs: { orderBy: { occurrence: "desc" }, take: 12, include: { invoice: { select: { id: true, invoiceNumber: true, documentStatus: true } } } },
    },
  });
  const today = todaySlovakia();
  return <>
    <PageHeader title="Pravidelné faktúry" subtitle="Plány a vytvorené koncepty">
      {canCreate && <Link className={btnSecondary} href="/financie/faktury?smer=VYDANA">Vybrať vzorovú faktúru</Link>}
    </PageHeader>
    <div className="grid gap-4">
      {schedules.map(schedule => <article id={`plan-${schedule.id}`} key={schedule.id} className={`${card} space-y-3 p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-semibold">{schedule.title}</h2><p className="text-sm text-stone-500">{schedule.sourceInvoice.client?.name ?? "—"} · {(schedule.paused ? "Pozastavený" : schedule.nextDate ? "Aktívny" : "Ukončený")}</p></div>
          <Link className="text-sm underline" href={`/financie/faktury/${schedule.sourceInvoice.id}`}>Vzor {schedule.sourceInvoice.invoiceNumber}</Link>
        </div>
        <p className="text-sm">Interval {schedule.intervalMonths} {schedule.intervalMonths === 1 ? "mesiac" : schedule.intervalMonths === 3 ? "mesiace" : "mesiacov"} · {schedule.nextDate ? `Ďalší termín ${formatDate(schedule.nextDate)}` : "Posledný termín bol spracovaný"} · Vytvorených {schedule.generatedCount}</p>
        {canCreate && <ScheduleActions id={schedule.id} paused={schedule.paused} next={schedule.nextDate?.toISOString().slice(0,10) ?? ""} due={!!schedule.nextDate && schedule.nextDate <= today} />}
        {!!schedule.runs.length && <details className="border-t border-stone-100 pt-3"><summary className="cursor-pointer text-sm font-semibold">Posledné doklady</summary>
          <ul className="mt-2 space-y-1 text-sm">{schedule.runs.map(run => <li key={run.invoiceId}>
            <Link className="underline" href={`/financie/faktury/${run.invoiceId}`}>{formatDate(run.occurrence)} · {run.invoice.invoiceNumber ?? "Koncept"}{run.invoice.documentStatus === "CANCELLED" ? " · zrušený" : ""}</Link>
          </li>)}</ul>
        </details>}
      </article>)}
      {!schedules.length && <p className={`${card} p-6 text-sm text-stone-600`}>Plán vytvoríš z detailu vystavenej faktúry.</p>}
    </div>
  </>;
}
