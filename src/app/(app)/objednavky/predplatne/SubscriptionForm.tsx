"use client";

import { useActionState, useState } from "react";
import type { OrderFormClient, OrderFormProduct } from "../OrderForm";
import type { OrderFormState } from "../_actions";
import { SUBSCRIPTION_FREQUENCY_LABELS } from "../konstanty";

const inputClass = "w-full rounded-[10px] border border-stone-300 px-3 py-2 text-sm focus:border-stone-950 focus:outline-none focus:ring-[3px] focus:ring-brand/35";

export function SubscriptionForm({
  action,
  clients,
  products,
}: {
  action: (state: OrderFormState, data: FormData) => Promise<OrderFormState>;
  clients: Pick<OrderFormClient, "id" | "name" | "type">[];
  products: OrderFormProduct[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [items, setItems] = useState([{ productId: "", quantity: 1 }]);

  return (
    <form action={formAction} className="space-y-4 rounded-[14px] border border-stone-200 bg-white p-5">
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <h2 className="font-semibold text-stone-900">Nové predplatné</h2>
      <div>
        <label htmlFor="clientId" className="mb-1 block text-sm font-medium text-stone-700">Klient *</label>
        <select id="clientId" name="clientId" required className={inputClass}>
          <option value="">— vyberte klienta —</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name} ({client.type})</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="frequency" className="mb-1 block text-sm font-medium text-stone-700">Frekvencia *</label>
          <select id="frequency" name="frequency" className={inputClass}>
            {Object.entries(SUBSCRIPTION_FREQUENCY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="nextRunDate" className="mb-1 block text-sm font-medium text-stone-700">Najbližší termín *</label>
          <input id="nextRunDate" name="nextRunDate" type="date" required className={inputClass} />
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-stone-700">Položky *</span>
          <button type="button" onClick={() => setItems((old) => [...old, { productId: "", quantity: 1 }])} className="text-sm text-stone-950 hover:underline">+ Pridať</button>
        </div>
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-[1fr_6rem_2rem] gap-2">
            <select value={item.productId} required onChange={(event) => setItems((old) => old.map((row, i) => i === index ? { ...row, productId: event.target.value } : row))} className={inputClass} aria-label={`Produkt ${index + 1}`}>
              <option value="">— vyberte produkt —</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
            <input type="number" min={1} step={1} value={item.quantity} onChange={(event) => setItems((old) => old.map((row, i) => i === index ? { ...row, quantity: Number.parseInt(event.target.value, 10) || 0 } : row))} className={inputClass} aria-label={`Množstvo ${index + 1}`} />
            <button type="button" disabled={items.length === 1} onClick={() => setItems((old) => old.filter((_, i) => i !== index))} className="text-stone-400 hover:text-red-600 disabled:opacity-30" aria-label={`Odstrániť položku ${index + 1}`}>✕</button>
          </div>
        ))}
      </div>
      <div>
        <label htmlFor="note" className="mb-1 block text-sm font-medium text-stone-700">Poznámka</label>
        <textarea id="note" name="note" rows={2} className={inputClass} />
      </div>
      {state.error && <p className="rounded-[10px] bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-brand-dark disabled:opacity-50">{pending ? "Ukladám…" : "Vytvoriť predplatné"}</button>
    </form>
  );
}

export function GenerateOrdersButton({ action }: { action: (state: OrderFormState, data: FormData) => Promise<OrderFormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <div>
      <form action={formAction}><button disabled={pending} className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-brand-dark disabled:opacity-50">{pending ? "Generujem…" : "Vygenerovať objednávky"}</button></form>
      {state.success && <p className="mt-2 text-sm text-stone-950">{state.success}</p>}
      {state.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
    </div>
  );
}
