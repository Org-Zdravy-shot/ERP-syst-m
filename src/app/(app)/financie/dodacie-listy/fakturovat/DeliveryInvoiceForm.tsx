"use client";

import { useActionState, useState } from "react";
import { btnPrimary, errorBox, input, label } from "@/components/ui";
import { createDeliveryInvoiceAction, type DeliveryFormState } from "../_actions";

interface Note { id: string; number: string; lines: { description: string; quantity: number; unit: string; unitPriceExact?: string }[] }
export function DeliveryInvoiceForm({ notes, issueDate, dueDate, buyerReference }: { notes: Note[]; issueDate: string; dueDate: string; buyerReference: string }) {
  const [state, action, pending] = useActionState<DeliveryFormState, FormData>(createDeliveryInvoiceAction, {});
  const [header, setHeader] = useState({ issueDate, dueDate, buyerReference, note: "" });
  const [prices, setPrices] = useState<Record<string, string>>({});
  return <form action={action} className="finance-document">
    {notes.map(note => <input type="hidden" key={note.id} name="dl" value={note.id} />)}
    <div className="finance-document-title"><h2>Koncept faktúry</h2><span>EUR</span></div>
    <div className="finance-editor-section grid gap-4 sm:grid-cols-2">
      <label className={label}>Vystavenie<input name="issueDate" type="date" required className={input} value={header.issueDate} onChange={event => setHeader({ ...header, issueDate: event.target.value })} /></label>
      <label className={label}>Splatnosť<input name="dueDate" type="date" required className={input} min={header.issueDate} value={header.dueDate} onChange={event => setHeader({ ...header, dueDate: event.target.value })} /></label>
      <label className={label}>Referencia odberateľa<input name="buyerReference" className={input} maxLength={140} value={header.buyerReference} onChange={event => setHeader({ ...header, buyerReference: event.target.value })} /></label>
      <label className={label}>Poznámka<input name="note" className={input} maxLength={1000} value={header.note} onChange={event => setHeader({ ...header, note: event.target.value })} /></label>
    </div>
    {notes.map(note => <section key={note.id} className="finance-editor-section">
      <h3>Dodací list {note.number}</h3>
      <div className="divide-y divide-stone-200">
        {note.lines.map((line, index) => {
          const name = `price:${note.id}:${index}`;
          return <div key={name} className="grid items-center gap-1 py-2 text-sm sm:grid-cols-[2fr_1fr] sm:gap-4">
            <div><strong>{line.description}</strong><div className="text-stone-500">{line.quantity} {line.unit}</div></div>
            {line.unitPriceExact ? <p className="text-stone-600">{line.unitPriceExact.replace(".", ",").replace(/0+$/, "").replace(/,$/, "")} €/j. bez DPH</p>
              : <label className={label}>Jednotková cena bez DPH (€)<input className={input} name={name} required maxLength={40} inputMode="decimal" value={prices[name] ?? ""} onChange={event => setPrices({ ...prices, [name]: event.target.value })} /></label>}
          </div>;
        })}
      </div>
    </section>)}
    <section className="finance-editor-section space-y-3">
      {state.error && <p role="alert" className={errorBox}>{state.error}</p>}
      <button type="submit" className={btnPrimary} disabled={pending}>{pending ? "Ukladám…" : "Vytvoriť koncept faktúry"}</button>
    </section>
  </form>;
}
