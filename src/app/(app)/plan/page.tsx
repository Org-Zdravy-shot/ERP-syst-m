import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/prisma";
import { formatCents, formatDate, MONTH_NAMES_SK } from "@/lib/format";
import { actualsFor, fulfillmentPct, getMonthlyActualsMap } from "@/lib/reporting";
import { getPeriodActuals, isoDate, planProgress, todayInSlovakia, type PeriodActuals } from "@/lib/period-reporting";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { PlanForm } from "./PlanForm";
import { PeriodPlanForm, type PeriodPlanValues } from "./PeriodPlanForm";
import { card, table, thead, tr } from "@/components/ui";

function FulfillmentBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-stone-400">bez cieľa</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-stone-100">
        <div className={`h-full ${pct >= 100 ? "bg-[#2DA815]" : "bg-brand-dark"}`} style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums text-stone-700">{pct} %</span>
    </div>
  );
}

function Metric({ label, actual, target, pace, ceiling = false, hint, units = false }: {
  label: string; actual: number; target: number; pace: number; ceiling?: boolean; hint: string; units?: boolean;
}) {
  const display = (n: number) => units ? `${n.toLocaleString("sk-SK")} ks` : formatCents(n);
  const expected = Math.round(target * pace);
  const difference = actual - expected;
  const healthy = ceiling ? difference <= 0 : difference >= 0;
  return (
    <div className="rounded-[14px] border border-stone-200 bg-white p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-2 font-display text-2xl font-bold tabular-nums text-stone-950">{display(actual)}</div>
      <p className="mt-1 text-sm text-stone-600">{target > 0 ? `Plán ${display(target)} · ${fulfillmentPct(actual, target)} %` : "Cieľ nie je nastavený"}</p>
      {target > 0 && <>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100"><div className={`h-full ${ceiling && actual > target ? "bg-red-500" : "bg-brand-dark"}`} style={{ width: `${Math.max(0, Math.min(100, actual / target * 100))}%` }} /></div>
        <p className={`mt-2 text-xs ${healthy ? "text-[#1F7A0F]" : "text-[#B91C1C]"}`}>
          K dnešku {difference >= 0 ? "+" : "−"}{display(Math.abs(difference))} voči rovnomernému tempu
        </p>
      </>}
      <p className="mt-2 text-xs text-stone-500">{hint}</p>
    </div>
  );
}

function monthRows(start: Date, end: Date, byMonth: Map<string, PeriodActuals>) {
  const rows: Array<{ key: string; label: string; actual: PeriodActuals }> = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    const key = isoDate(cursor).slice(0, 7);
    rows.push({
      key,
      label: `${MONTH_NAMES_SK[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`,
      actual: byMonth.get(key) ?? { invoicedGrossCents: 0, invoicedNetCents: 0, ekasaGrossCents: 0, costsNetCents: 0, cashInCents: 0, cashOutCents: 0, productionUnits: 0 },
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return rows;
}

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const user = await requireFinancePermission("VIEW");
  const today = todayInSlovakia();
  const [periodPlans, monthlyPlans, monthlyActuals] = await Promise.all([
    prisma.periodPlan.findMany({ orderBy: [{ endDate: "desc" }, { createdAt: "desc" }] }),
    prisma.monthlyPlan.findMany({ orderBy: [{ year: "desc" }, { month: "desc" }] }),
    getMonthlyActualsMap(),
  ]);
  const selectedId = (await searchParams).plan;
  const selected = periodPlans.find((p) => p.id === selectedId) ?? periodPlans.find((p) => p.startDate <= today && p.endDate >= today) ?? periodPlans[0];
  const report = selected ? await getPeriodActuals(selected.startDate, selected.endDate) : null;
  const canEdit = user.role === "admin" || user.role === "FINANCE_ADMIN";
  const formValues: PeriodPlanValues = selectedId && selected && selected.id === selectedId ? {
    id: selected.id, name: selected.name, startDate: isoDate(selected.startDate), endDate: isoDate(selected.endDate),
    targetTurnoverGrossCents: selected.targetTurnoverGrossCents, targetRevenueNetCents: selected.targetRevenueNetCents,
    targetCostsNetCents: selected.targetCostsNetCents, targetCashInCents: selected.targetCashInCents,
    targetCashOutCents: selected.targetCashOutCents, targetProductionUnits: selected.targetProductionUnits,
    note: selected.note,
  } : {
    name: `Plán do konca roka ${today.getUTCFullYear()}`,
    startDate: isoDate(today), endDate: `${today.getUTCFullYear()}-12-31`,
    targetTurnoverGrossCents: 0, targetRevenueNetCents: 0, targetCostsNetCents: 0,
    targetCashInCents: 0, targetCashOutCents: 0, targetProductionUnits: 0,
  };
  const pace = selected ? planProgress(selected.startDate, selected.endDate, today) : 0;
  const total = report?.total;
  const months = selected && report ? monthRows(selected.startDate, selected.endDate, report.byMonth) : [];

  return <>
    <PageHeader title="Plnenie plánu" subtitle="Ľubovoľné obdobie, ciele a skutočnosť z aktuálnych dokladov" />
    {canEdit && <div className="mb-6"><PeriodPlanForm key={formValues.id ?? "new"} values={formValues} /></div>}

    <div className={`${card} mb-6 p-5`}>
      <h2 className="mb-3 text-base font-semibold text-stone-950">Uložené obdobia</h2>
      {periodPlans.length === 0 ? <p className="text-sm text-stone-500">Zatiaľ nemáte plán na vlastné obdobie. Predvyplnené je obdobie od dneška do konca roka.</p> : <div className="flex flex-wrap gap-2">
        {periodPlans.map((plan) => <Link key={plan.id} href={`/plan?plan=${encodeURIComponent(plan.id)}`} className={`rounded-lg border px-3 py-2 text-sm ${selected?.id === plan.id ? "border-brand-dark bg-brand/15 font-semibold" : "border-stone-200 hover:bg-stone-50"}`}>
          {plan.name} · {formatDate(plan.startDate)} – {formatDate(plan.endDate)}
        </Link>)}
      </div>}
    </div>

    {selected && total && <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-xl font-bold text-stone-950">{selected.name}</h2><p className="text-sm text-stone-500">{formatDate(selected.startDate)} – {formatDate(selected.endDate)} · uplynulo {Math.round(pace * 100)} % obdobia</p></div>
        {selected.note && <p className="max-w-xl text-sm text-stone-600">{selected.note}</p>}
      </div>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="Obrat dokladov s DPH" actual={total.invoicedGrossCents + total.ekasaGrossCents} target={selected.targetTurnoverGrossCents} pace={pace} hint="Vydané faktúry po dobropisoch + nespárovaná eKasa" />
        <Metric label="Fakturované výnosy bez DPH" actual={total.invoicedNetCents} target={selected.targetRevenueNetCents} pace={pace} hint="Iba vydané faktúry po dobropisoch" />
        <Metric label="Náklady z prijatých faktúr bez DPH" actual={total.costsNetCents} target={selected.targetCostsNetCents} pace={pace} ceiling hint="Prijaté faktúry po dobropisoch; strop rozpočtu" />
        <Metric label="Peňažné príjmy" actual={total.cashInCents} target={selected.targetCashInCents} pace={pace} hint="Evidované prichádzajúce platby" />
        <Metric label="Peňažné výdavky" actual={total.cashOutCents} target={selected.targetCashOutCents} pace={pace} ceiling hint="Evidované odchádzajúce platby; strop rozpočtu" />
        <Metric label="Vyrobené kusy" actual={total.productionUnits} target={selected.targetProductionUnits} pace={pace} hint="Dokončené šarže" units />
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className={`${card} p-4`}><p className="text-xs text-stone-500">Vydané faktúry s DPH</p><p className="mt-1 font-semibold tabular-nums">{formatCents(total.invoicedGrossCents)}</p></div>
        <div className={`${card} p-4`}><p className="text-xs text-stone-500">Nespárovaná eKasa s DPH</p><p className="mt-1 font-semibold tabular-nums">{formatCents(total.ekasaGrossCents)}</p></div>
        <div className={`${card} p-4`}><p className="text-xs text-stone-500">Čistý tok evidovaných platieb</p><p className="mt-1 font-semibold tabular-nums">{formatCents(total.cashInCents - total.cashOutCents)}</p></div>
      </div>
      <div className={`${card} mb-6 overflow-x-auto`}>
        <div className="border-b border-stone-100 px-5 py-3 font-semibold">Vývoj v období po mesiacoch</div>
        <table className={table}><thead><tr className={thead}>
          <th className="px-4 py-2 text-left">Mesiac</th><th className="px-4 py-2 text-right">Obrat s DPH</th><th className="px-4 py-2 text-right">Výnosy bez DPH</th><th className="px-4 py-2 text-right">Náklady bez DPH</th><th className="px-4 py-2 text-right">Príjmy</th><th className="px-4 py-2 text-right">Výdavky</th><th className="px-4 py-2 text-right">Výroba</th>
        </tr></thead><tbody>{months.map(({ key, label, actual }) => <tr key={key} className={tr}>
          <td className="px-4 py-2 font-medium">{label}</td><td className="px-4 py-2 text-right tabular-nums">{formatCents(actual.invoicedGrossCents + actual.ekasaGrossCents)}</td><td className="px-4 py-2 text-right tabular-nums">{formatCents(actual.invoicedNetCents)}</td><td className="px-4 py-2 text-right tabular-nums">{formatCents(actual.costsNetCents)}</td><td className="px-4 py-2 text-right tabular-nums">{formatCents(actual.cashInCents)}</td><td className="px-4 py-2 text-right tabular-nums">{formatCents(actual.cashOutCents)}</td><td className="px-4 py-2 text-right tabular-nums">{actual.productionUnits} ks</td>
        </tr>)}</tbody></table>
      </div>
      <p className="mb-8 text-xs text-stone-500">Obrat je prevádzkový súčet dokladov s DPH, nie zákonný obrat pre registráciu DPH. Spárovanú eKasu odpočítavame; ak rovnaký predaj zostal nespárovaný, môže byť započítaný dvakrát. Spárovaný predaj patrí do obdobia dátumu vystavenia faktúry. Fakturované výnosy nezahŕňajú eKasu, pretože časť jej záznamov nemá sadzbu DPH. Náklady sú prijaté faktúry, nie úplný účtovný výsledok. Platby môžu obsahovať aj úhrady faktúr z iného obdobia. Tempo je rovnomerne rozložený cieľ podľa kalendárnych dní.</p>
    </>}

    <details className={`${card} p-5`}>
      <summary className="cursor-pointer font-semibold text-stone-950">Pôvodné mesačné plány</summary>
      <div className="pt-5">{canEdit && <PlanForm defaultYear={today.getUTCFullYear()} defaultMonth={today.getUTCMonth() + 1} />}</div>
      <div className="overflow-x-auto"><table className={table}><thead><tr className={thead}>
        <th className="px-4 py-2 text-left">Mesiac</th><th className="px-4 py-2 text-right">Cieľ tržieb</th><th className="px-4 py-2 text-right">Skutočnosť</th><th className="px-4 py-2 text-left">Plnenie</th><th className="px-4 py-2 text-right">Cieľ výroby</th><th className="px-4 py-2 text-right">Vyrobené</th><th className="px-4 py-2 text-left">Plnenie</th>
      </tr></thead><tbody>{monthlyPlans.map((plan) => {
        const actual = actualsFor(monthlyActuals, plan.year, plan.month);
        return <tr key={plan.id} className={tr}><td className="px-4 py-2 font-medium">{MONTH_NAMES_SK[plan.month - 1]} {plan.year}</td><td className="px-4 py-2 text-right">{formatCents(plan.targetRevenueCents)}</td><td className="px-4 py-2 text-right">{formatCents(actual.revenueCents)}</td><td className="px-4 py-2"><FulfillmentBar pct={fulfillmentPct(actual.revenueCents, plan.targetRevenueCents)} /></td><td className="px-4 py-2 text-right">{plan.targetProductionUnits} ks</td><td className="px-4 py-2 text-right">{actual.productionUnits} ks</td><td className="px-4 py-2"><FulfillmentBar pct={fulfillmentPct(actual.productionUnits, plan.targetProductionUnits)} /></td></tr>;
      })}</tbody></table></div>
    </details>
  </>;
}
