"use client";

import { useActionState, useState } from "react";
import { InvoiceCustomerPicker, type ClientOption } from "../../faktury/nova/InvoiceCustomerPicker";
import { legalEntityLabels } from "@/lib/zod-schemas";
import { btnPrimary, btnSmall, errorBox, input, label } from "@/components/ui";
import { issueDeliveryNoteAction, type DeliveryFormState } from "../_actions";

interface Line { key: number; productId?: string; description: string; quantity: string; unit: string; price: string }
const emptyLine = { description: "", quantity: "1", unit: "ks", price: "" };
type Product = { id: string; name: string; sku: string; unit: string };
type OrderSource = { id: string; number: string; client: string; version: string; legalEntity: string; rows: { id: string; description: string; quantity: number; unit: string }[] };

export function DeliveryNoteForm({ clients, products, order, today, deliveryDate, defaultIssuer, submissionKey }: {
  clients: ClientOption[]; products: Product[]; order?: OrderSource; today: string;
  deliveryDate: string; defaultIssuer?: string; submissionKey: string;
}) {
  const [state, action, pending] = useActionState<DeliveryFormState, FormData>(issueDeliveryNoteAction, {});
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine, key: 0 }]);
  const [nextKey, setNextKey] = useState(1);
  const [savingClient, setSavingClient] = useState(false);
  const [header, setHeader] = useState({ legalEntity: defaultIssuer ?? "", issueDate: today, deliveryDate, buyerOrderNumber: "", deliveryAddress: "", note: "" });
  const update = (key: number, patch: Partial<Line>) => setLines(previous => previous.map(row => row.key === key ? { ...row, ...patch } : row));
  const rows = lines.map(row => ({
    description: row.description, unit: row.unit,
    quantity: Number(row.quantity.trim().replace(",", ".")),
    productId: row.productId, unitPriceExact: row.price.trim() || undefined,
  }));
  return (
    <form action={action} className="space-y-5">
      <input name="submissionKey" type="hidden" value={submissionKey} />
      <div className="finance-document">
        <div className="finance-document-title"><h2>Nový dodací list</h2><span>EUR</span></div>
        {order ? <>
          <input name="orderId" type="hidden" value={order.id} />
          <input name="expectedOrderUpdatedAt" type="hidden" value={order.version} />
          <section className="finance-editor-section"><h3>Dodanie z objednávky {order.number}</h3><p>{legalEntityLabels[order.legalEntity]} · {order.client}</p></section>
        </> : <>
          <input name="lines" type="hidden" value={JSON.stringify(rows)} />
          <div className="finance-parties">
            <section><h3>Dodávateľ</h3><label className={label}>Vaša firma
              <select name="legalEntity" className={input} value={header.legalEntity} onChange={event => setHeader({ ...header, legalEntity: event.target.value })} required>
                <option value="" disabled>Vyberte právny subjekt</option>
                {Object.entries(legalEntityLabels).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label></section>
            <section><h3>Odberateľ</h3><InvoiceCustomerPicker clients={clients} onSavingChange={setSavingClient} /></section>
          </div>
        </>}
        <div className="finance-editor-section grid gap-4 sm:grid-cols-2">
          <label className={label}>Dátum vystavenia<input type="date" className={input} name="issueDate" value={header.issueDate} onChange={event => setHeader({ ...header, issueDate: event.target.value })} required /></label>
          <label className={label}>Dátum dodania<input type="date" className={input} name="deliveryDate" value={header.deliveryDate} onChange={event => setHeader({ ...header, deliveryDate: event.target.value })} required /></label>
          <label className={label}>Objednávka odberateľa<input className={input} name="buyerOrderNumber" maxLength={140} value={header.buyerOrderNumber} onChange={event => setHeader({ ...header, buyerOrderNumber: event.target.value })} /></label>
          <label className={label}>Adresa dodania<input className={input} name="deliveryAddress" maxLength={500} value={header.deliveryAddress} onChange={event => setHeader({ ...header, deliveryAddress: event.target.value })} placeholder={order ? "Preberie sa z objednávky" : "Ak sa líši od sídla odberateľa"} /></label>
        </div>
        <section className="finance-editor-section">
          <h3>Dodané položky</h3>
          {order ? <ul className="divide-y divide-stone-200">{order.rows.map(row => <li key={row.id} className="flex justify-between gap-4 py-2"><span>{row.description}</span><span className="shrink-0">{row.quantity} {row.unit}</span></li>)}</ul>
          : <>
            <div className="space-y-3">
              {lines.map((row, index) => (
                <fieldset key={row.key} className="rounded-lg border border-stone-200 p-3">
                  <legend className="px-2 text-sm font-semibold">Položka {index + 1}</legend>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_2fr_1fr_1fr_1fr]">
                    <label className={label}>Produkt
                      <select className={input} value={row.productId ?? ""} onChange={event => {
                        const product = products.find(item => item.id === event.target.value);
                        update(row.key, product ? { productId: product.id, description: product.name, unit: product.unit, price: "" } : { productId: undefined });
                      }}>
                        <option value="">Ručná položka</option>
                        {products.map(p => <option value={p.id} key={p.id}>{p.name} · {p.sku}</option>)}
                      </select>
                    </label>
                    <label className={label}>Popis<input className={input} value={row.description} required maxLength={300} onChange={event => update(row.key, { description: event.target.value })} /></label>
                    <label className={label}>Množstvo<input className={input} inputMode="decimal" required value={row.quantity} onChange={event => update(row.key, { quantity: event.target.value })} /></label>
                    <label className={label}>Jednotka<input className={input} required maxLength={20} value={row.unit} onChange={event => update(row.key, { unit: event.target.value })} /></label>
                    <label className={label}>Cena bez DPH<input className={input} inputMode="decimal" placeholder="Voliteľná" value={row.price} onChange={event => update(row.key, { price: event.target.value })} /></label>
                  </div>
                  {lines.length > 1 && <button type="button" className="mt-2 text-sm text-red-700 hover:underline" onClick={() => setLines(previous => previous.filter(line => line.key !== row.key))}>Odstrániť</button>}
                </fieldset>
              ))}
            </div>
            <button type="button" disabled={lines.length >= 100} className={`${btnSmall} mt-3`} onClick={() => {
              setLines(previous => [...previous, { ...emptyLine, key: nextKey }]);
              setNextKey(nextKey + 1);
            }}>Pridať položku</button>
          </>}
        </section>
        <section className="finance-editor-section">
          <label className={label}>Poznámka na dodacom liste<textarea className={input} name="note" maxLength={1000} rows={3} value={header.note} onChange={event => setHeader({ ...header, note: event.target.value })} /></label>
        </section>
        <section className="finance-editor-section space-y-3">
          {state.error && <p role="alert" className={errorBox}>{state.error}</p>}
          <button type="submit" className={btnPrimary} disabled={pending || savingClient}>{pending ? "Vystavujem…" : "Vystaviť dodací list"}</button>
        </section>
      </div>
    </form>
  );
}
