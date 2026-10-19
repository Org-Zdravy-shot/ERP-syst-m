"use client";

import Link from "next/link";
import { useActionState } from "react";
import { savePeriodPlan, type PlanFormState } from "./_actions";
import { errorBox, input, labelSmall } from "@/components/ui";

export interface PeriodPlanValues {
  id?: string;
  name: string;
  startDate: string;
  endDate: string;
  targetTurnoverGrossCents: number;
  targetRevenueNetCents: number;
  targetCostsNetCents: number;
  targetCashInCents: number;
  targetCashOutCents: number;
  targetProductionUnits: number;
  note?: string | null;
}

const moneyFields = [
  { key: "targetTurnoverGrossCents", label: "Cieľ obratu s DPH", hint: "Vydané faktúry + eKasa" },
  { key: "targetRevenueNetCents", label: "Cieľ výnosov bez DPH", hint: "Vydané faktúry" },
  { key: "targetCostsNetCents", label: "Strop nákladov bez DPH", hint: "Prijaté faktúry" },
  { key: "targetCashInCents", label: "Cieľ peňažných príjmov", hint: "Zaúčtované platby" },
  { key: "targetCashOutCents", label: "Strop peňažných výdavkov", hint: "Zaúčtované platby" },
] as const;

export function PeriodPlanForm({ values }: { values: PeriodPlanValues }) {
  const [state, action, pending] = useActionState<PlanFormState, FormData>(savePeriodPlan, {});
  return (
    <form action={action} className="rounded-[14px] border border-stone-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-stone-950">{values.id ? "Upraviť plán" : "Nový plán na obdobie"}</h2>
        {values.id && <Link href="/plan" className="text-sm text-stone-600 underline">Nový plán</Link>}
      </div>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label htmlFor="period-name" className={labelSmall}>Názov plánu</label>
          <input id="period-name" name="name" defaultValue={values.name} maxLength={120} required className={input} />
        </div>
        <div>
          <label htmlFor="period-start" className={labelSmall}>Od</label>
          <input id="period-start" name="startDate" type="date" defaultValue={values.startDate} required className={input} />
        </div>
        <div>
          <label htmlFor="period-end" className={labelSmall}>Do (vrátane)</label>
          <input id="period-end" name="endDate" type="date" defaultValue={values.endDate} required className={input} />
        </div>
        <div>
          <label htmlFor="period-units" className={labelSmall}>Cieľ výroby (ks)</label>
          <input id="period-units" name="targetProductionUnits" type="number" min="0" step="1" defaultValue={values.targetProductionUnits || ""} className={input} />
        </div>
        {moneyFields.map(({ key, label, hint }) => (
          <div key={key}>
            <label htmlFor={key} className={labelSmall}>{label} (€)</label>
            <input id={key} name={key} inputMode="decimal" placeholder="napr. 5000" defaultValue={values[key] ? (values[key] / 100).toFixed(2) : ""} className={input} />
            <p className="mt-1 text-xs text-stone-500">{hint}</p>
          </div>
        ))}
        <div className="sm:col-span-3">
          <label htmlFor="period-note" className={labelSmall}>Poznámka</label>
          <textarea id="period-note" name="note" defaultValue={values.note ?? ""} maxLength={1000} rows={2} className={input} />
        </div>
      </div>
      {state.error && <p className={`${errorBox} mt-4`}>{state.error}</p>}
      <button type="submit" disabled={pending} className="mt-4 rounded-[10px] bg-brand px-5 py-2.5 text-sm font-semibold text-stone-950 hover:bg-brand-dark disabled:opacity-50">
        {pending ? "Ukladám…" : values.id ? "Uložiť zmeny" : "Vytvoriť plán"}
      </button>
    </form>
  );
}
