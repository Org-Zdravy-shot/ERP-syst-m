import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/prisma";
import { formatCents, MONTH_NAMES_SK } from "@/lib/format";
import { actualsFor, fulfillmentPct, getMonthlyActualsMap } from "@/lib/reporting";
import { PlanForm } from "./PlanForm";
import { card, table, thead, tr } from "@/components/ui";

function FulfillmentBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-stone-400">bez cieľa</span>;
  const color = pct >= 100 ? "bg-[#2DA815]" : "bg-brand-dark";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-stone-100">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums text-stone-700">{pct} %</span>
    </div>
  );
}

export default async function PlanPage() {
  const [plans, actualsMap] = await Promise.all([
    prisma.monthlyPlan.findMany({ orderBy: [{ year: "desc" }, { month: "desc" }] }),
    getMonthlyActualsMap(),
  ]);

  const now = new Date();

  return (
    <>
      <PageHeader
        title="Plnenie plánu"
        subtitle="Mesačné ciele vs. evidované predaje (vydané doklady + nespárovaná eKasa) a hotové šarže"
      />

      <PlanForm defaultYear={now.getFullYear()} defaultMonth={now.getMonth() + 1} />

      <div className={`${card} overflow-x-auto`}>
        <table className={table}>
          <thead>
            <tr className={thead}>
              <th className="px-[18px] py-[11px] font-medium">Mesiac</th>
              <th className="px-[18px] py-[11px] text-right font-medium">Cieľ tržieb</th>
              <th className="px-[18px] py-[11px] text-right font-medium">Skutočnosť</th>
              <th className="px-[18px] py-[11px] font-medium">Plnenie</th>
              <th className="px-[18px] py-[11px] text-right font-medium">Cieľ výroby</th>
              <th className="px-[18px] py-[11px] text-right font-medium">Vyrobené</th>
              <th className="px-[18px] py-[11px] font-medium">Plnenie</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => {
              const actual = actualsFor(actualsMap, plan.year, plan.month);
              return (
                <tr key={plan.id} className={tr}>
                  <td className="px-[18px] py-[11px] font-medium text-stone-950">
                    {MONTH_NAMES_SK[plan.month - 1]} {plan.year}
                  </td>
                  <td className="px-[18px] py-[11px] text-right tabular-nums text-stone-500">
                    {formatCents(plan.targetRevenueCents)}
                  </td>
                  <td className="px-[18px] py-[11px] text-right font-medium tabular-nums">
                    {formatCents(actual.revenueCents)}
                  </td>
                  <td className="px-[18px] py-[11px]">
                    <FulfillmentBar pct={fulfillmentPct(actual.revenueCents, plan.targetRevenueCents)} />
                  </td>
                  <td className="px-[18px] py-[11px] text-right tabular-nums text-stone-500">
                    {plan.targetProductionUnits} ks
                  </td>
                  <td className="px-[18px] py-[11px] text-right font-medium tabular-nums">
                    {actual.productionUnits} ks
                  </td>
                  <td className="px-[18px] py-[11px]">
                    <FulfillmentBar
                      pct={fulfillmentPct(actual.productionUnits, plan.targetProductionUnits)}
                    />
                  </td>
                </tr>
              );
            })}
            {plans.length === 0 && (
              <tr className={tr}>
                <td colSpan={7} className="px-[18px] py-8 text-center text-stone-400">
                  Zatiaľ žiadne plány — nastavte prvý cieľ vo formulári vyššie
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
