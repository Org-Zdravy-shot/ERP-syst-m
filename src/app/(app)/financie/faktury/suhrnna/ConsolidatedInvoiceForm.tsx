"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { btnPrimary, input, label, errorBox } from "@/components/ui";
import { formatCents } from "@/lib/format";
import { createConsolidatedInvoice } from "./_actions";

interface OrderChoice { id: string; orderNumber: string; orderDate: string; expectedUpdatedAt: string; deliveryDate: string; totalGrossCents: number }
export function ConsolidatedInvoiceForm({ orders, today }: { orders: OrderChoice[]; today: string }) {
  const [state, action, pending] = useActionState(createConsolidatedInvoice, {});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState<Record<string, { deliveryDate: string; buyerOrderNumber: string; deliveryNoteNumber: string }>>({});
  const [issueDate, setIssueDate] = useState(today);
  const due = new Date(`${today}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + 14);
  const [dueDate, setDueDate] = useState(due.toISOString().slice(0, 10));
  const [reference, setReference] = useState(""); const [note, setNote] = useState("");
  const values = (o: OrderChoice) => details[o.id] ?? { deliveryDate: o.deliveryDate, buyerOrderNumber: "", deliveryNoteNumber: "" };
  const chosen = orders.filter(o => selected[o.id]);
  const months = new Set(chosen.map(o => values(o).deliveryDate.slice(0, 7)).filter(Boolean));
  const total = chosen.reduce((sum, o) => sum + o.totalGrossCents, 0);
  if (!orders.length) return <p className="rounded-xl border border-stone-200 bg-white p-5 text-sm">Pre tento výber nie sú doručené nevyfakturované objednávky.</p>;
  return <form action={action} className="space-y-5">
    <input type="hidden" name="orders" value={JSON.stringify(chosen.map(o => ({ orderId: o.id, expectedUpdatedAt: o.expectedUpdatedAt, ...values(o), deliveryNoteNumber: values(o).deliveryNoteNumber.trim() || undefined })))} />
    <div className="space-y-3">{orders.map(o => <section key={o.id} className={`rounded-xl border p-4 ${selected[o.id] ? "border-brand bg-amber-50/40" : "border-stone-200 bg-white"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-3 font-semibold"><input type="checkbox" checked={!!selected[o.id]} disabled={pending || (!selected[o.id] && chosen.length >= 50)} onChange={e => setSelected({ ...selected, [o.id]: e.target.checked })} className="h-4 w-4 accent-yellow-400" />{o.orderNumber}</label>
        <span className="text-sm text-stone-600">{o.orderDate} · {formatCents(o.totalGrossCents)} · <Link className="underline" target="_blank" href={`/objednavky/${o.id}`}>Detail</Link></span>
      </div>
      {selected[o.id] && <div className="mt-4 grid gap-4 sm:grid-cols-3">{([
        ["deliveryDate", "Skutočný dátum dodania", "date"], ["buyerOrderNumber", "Číslo objednávky odberateľa", "text"], ["deliveryNoteNumber", "Číslo dodacieho listu (voliteľné)", "text"],
      ] as const).map(([key, caption, type]) => <label key={key} className={label}>{caption}<input className={input} type={type} required={key !== "deliveryNoteNumber"} max={type === "date" ? issueDate : undefined} maxLength={type === "text" ? 140 : undefined} value={values(o)[key]} onChange={e => setDetails({ ...details, [o.id]: { ...values(o), [key]: e.target.value } })} /></label>)}</div>}
    </section>)}</div>
    <section className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>Dátum vystavenia<input className={input} type="date" name="issueDate" value={issueDate} onChange={e => setIssueDate(e.target.value)} required /></label>
        <label className={label}>Splatnosť<input className={input} type="date" name="dueDate" min={issueDate} value={dueDate} onChange={e => setDueDate(e.target.value)} required /></label>
        <label className={label}>Referencia odberateľa<input className={input} name="buyerReference" placeholder="Referencia dohodnutá s odberateľom" maxLength={140} value={reference} onChange={e => setReference(e.target.value)} required /></label>
      </div>
      <label className={`${label} mt-3`}>Poznámka<textarea className={input} name="note" maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <p className="mt-4 font-semibold">Vybrané objednávky: {chosen.length} / 50 · Predbežne {formatCents(total)} s DPH</p>
      <p className="mt-1 text-xs text-stone-500">Presné sadzby DPH sa overia podľa jednotlivých dátumov dodania pri vystavení.</p>
      {months.size > 1 && <p className={`${errorBox} mt-3`} role="alert">Dodania sú z rôznych mesiacov. Rozdeľte ich do samostatných faktúr.</p>}
      {state.error && <p className={`${errorBox} mt-3`} role="alert">{state.error}</p>}
      <button className={`${btnPrimary} mt-4`} disabled={pending || chosen.length < 2 || months.size > 1}>{pending ? "Ukladám koncept…" : "Vytvoriť súhrnný koncept"}</button>
    </section>
  </form>;
}
