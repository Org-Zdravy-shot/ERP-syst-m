"use client";

import { useActionState, useState } from "react";
import { btnPrimary, errorBox, input, label } from "@/components/ui";
import { createRecurringAction } from "../_actions";

export function RecurringForm({ sourceId, submissionKey, today }: { sourceId: string; submissionKey: string; today: string }) {
  const [state, action, pending] = useActionState(createRecurringAction, {});
  const [header, set] = useState({ title: "", startDate: today, intervalMonths: "1", dueDays: "14", maxCount: "" });
  return <form action={action} className="finance-document">
    <input name="sourceInvoiceId" type="hidden" value={sourceId} />
    <input name="submissionKey" type="hidden" value={submissionKey} />
    <div className="finance-document-title"><h2>Plán fakturácie</h2><span>EUR</span></div>
    <section className="finance-editor-section grid gap-4 sm:grid-cols-2">
      <label className={label}>Názov plánu<input name="title" required maxLength={150} className={input} value={header.title} onChange={event => set({ ...header, title: event.target.value })} /></label>
      <label className={label}>Prvý termín<input name="startDate" type="date" required className={input} value={header.startDate} onChange={event => set({ ...header, startDate: event.target.value })} /></label>
      <label className={label}>Interval<select name="intervalMonths" className={input} value={header.intervalMonths} onChange={event => set({ ...header, intervalMonths: event.target.value })}>
        <option value="1">Mesačne</option><option value="3">Štvrťročne</option><option value="6">Polročne</option><option value="12">Ročne</option>
      </select></label>
      <label className={label}>Splatnosť v dňoch<input name="dueDays" type="number" required min={0} max={180} className={input} value={header.dueDays} onChange={event => set({ ...header, dueDays: event.target.value })} /></label>
      <label className={label}>Počet plánovaných konceptov<input name="maxCount" type="number" min={1} max={999} placeholder="Bez obmedzenia" className={input} value={header.maxCount} onChange={event => set({ ...header, maxCount: event.target.value })} /></label>
    </section>
    <section className="finance-editor-section space-y-3">
      <p className="text-sm text-stone-600">V každom termíne vznikne koncept na kontrolu s položkami vzorovej faktúry.</p>
      {state.error && <p role="alert" className={errorBox}>{state.error}</p>}
      <button disabled={pending} className={btnPrimary}>{pending ? "Ukladám…" : "Uložiť plán"}</button>
    </section>
  </form>;
}
