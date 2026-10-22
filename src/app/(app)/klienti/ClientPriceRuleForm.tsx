"use client";

import { useActionState, useState } from "react";
import type { ClientProductPriceFormState } from "./_actions";

export function ClientPriceRuleForm({
  action, products, today,
}: {
  action: (state: ClientProductPriceFormState, formData: FormData) => Promise<ClientProductPriceFormState>;
  products: Array<{ id: string; name: string; sku: string }>;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [kind, setKind] = useState("FIXED");
  const input = "w-full rounded-[10px] border border-stone-300 px-3 py-2 text-sm";
  return <form action={formAction} className="rounded-[14px] border border-stone-200 bg-white p-5">
    <h2 className="font-semibold text-stone-900">Nová verzia B2B ceny</h2>
    <p className="mt-1 text-xs text-stone-500">Účinnosť sa určuje podľa dátumu dodania. Pri rovnakom dni platí posledná uložená verzia. Staré objednávky si ponechajú svoju cenu.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Produkt
        <select name="productId" required className={`${input} mt-1`} defaultValue="">
          <option value="" disabled>— vyberte produkt —</option>
          {products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}
        </select>
      </label>
      <label className="text-sm">Platí od
        <input name="effectiveFrom" type="date" required defaultValue={today} className={`${input} mt-1`} />
      </label>
      <label className="text-sm">Pravidlo
        <select name="kind" value={kind} onChange={(event) => setKind(event.target.value)} className={`${input} mt-1`}>
          <option value="FIXED">Pevná cena bez DPH</option>
          <option value="DISCOUNT">Zľava zo základnej B2B ceny</option>
          <option value="DEFAULT">Späť na základný cenník</option>
        </select>
      </label>
      {kind !== "DEFAULT" && <label className="text-sm">{kind === "FIXED" ? "Cena v € bez DPH" : "Zľava v %"}
        <input name="value" required inputMode="decimal" placeholder={kind === "FIXED" ? "napr. 3,50" : "napr. 10,5"} className={`${input} mt-1`} />
      </label>}
      <label className="text-sm sm:col-span-2">Poznámka k dohode
        <input name="note" maxLength={240} className={`${input} mt-1`} />
      </label>
    </div>
    <div className="mt-4 flex items-center justify-between gap-3">
      <div aria-live="polite" className="text-sm">{state.error && <span className="text-red-700">{state.error}</span>}{state.success && <span className="text-green-700">{state.success}</span>}</div>
      <button disabled={pending} className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-stone-950 disabled:opacity-50">{pending ? "Ukladám…" : "Uložiť verziu"}</button>
    </div>
  </form>;
}
