"use client";

import { useActionState, useState } from "react";
import { createStockMovement, type MovementFormState } from "./_actions";
import { errorBox, input, labelSmall } from "@/components/ui";

interface Item {
  id: string;
  name: string;
  unit: string;
}

export function MovementForm({ materials, products, batches }: { materials: Item[]; products: Item[]; batches: Array<{ id: string; productId: string; batchNumber: string; expiryDate: string }> }) {
  const [itemRef, setItemRef] = useState("");
  const [state, formAction, pending] = useActionState<MovementFormState, FormData>(
    createStockMovement,
    {},
  );

  return (
    <form
      action={formAction}
      className="mb-6 grid grid-cols-1 gap-3 rounded-[14px] border border-stone-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6"
    >
      <div className="lg:col-span-1">
        <label className={labelSmall}>Typ pohybu</label>
        <select name="type" required className={input} defaultValue="PRIJEM">
          <option value="PRIJEM">Príjem</option>
          <option value="VYDAJ">Výdaj</option>
          <option value="KOREKCIA">Korekcia</option>
        </select>
      </div>

      <div className="lg:col-span-2">
        <label className={labelSmall}>Položka</label>
        <select name="itemRef" required className={input} value={itemRef} onChange={(event) => setItemRef(event.target.value)}>
          <option value="" disabled>
            — vyberte —
          </option>
          <optgroup label="Suroviny">
            {materials.map((m) => (
              <option key={m.id} value={`m:${m.id}`}>
                {m.name} ({m.unit})
              </option>
            ))}
          </optgroup>
          <optgroup label="Produkty">
            {products.map((p) => (
              <option key={p.id} value={`p:${p.id}`}>
                {p.name} ({p.unit})
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {itemRef.startsWith("p:") && <div className="sm:col-span-2 lg:col-span-6">
        <label className={labelSmall}>Šarža produktu (voliteľné)</label>
        <select name="batchId" className={input} defaultValue="" key={itemRef}>
          <option value="">Automaticky podľa exspirácie pri výdaji / neurčená pri príjme</option>
          {batches.filter((batch) => batch.productId === itemRef.slice(2)).map((batch) => (
            <option key={batch.id} value={batch.id}>{batch.batchNumber} · exspirácia {batch.expiryDate}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-stone-500">Pri korekcii exspirovanej šarže ju vyberte výslovne. Príjem bez šarže zostane v sklade nepriradený.</p>
      </div>}

      <div>
        <label className={labelSmall}>Množstvo</label>
        <input name="quantity" required placeholder="napr. 5 alebo 2,5" className={input} />
      </div>

      <div>
        <label className={labelSmall}>
          Cena/jedn. € <span className="text-stone-400">(pri príjme)</span>
        </label>
        <input name="unitPrice" placeholder="napr. 4,50" className={input} />
      </div>

      <div className="flex items-end">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-[10px] bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-stone-950 transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Ukladám…" : "Uložiť pohyb"}
        </button>
      </div>

      <div className="sm:col-span-2 lg:col-span-6">
        <label className={labelSmall}>Poznámka</label>
        <input name="note" placeholder="napr. dodávka od Bio Farma Šariš" className={input} />
      </div>

      {state.error && <p className={`${errorBox} sm:col-span-2 lg:col-span-6`}>{state.error}</p>}
    </form>
  );
}
