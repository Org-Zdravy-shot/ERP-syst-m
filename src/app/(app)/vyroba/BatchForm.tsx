"use client";

import { useActionState } from "react";
import { createBatch, type BatchFormState } from "./_actions";
import { btnPrimary, errorBox, input, label } from "@/components/ui";

interface ProductOption {
  id: string;
  name: string;
  shelfLifeDays: number | null;
  hasRecipe: boolean;
}

export function BatchForm({ products, today }: { products: ProductOption[]; today: string }) {
  const [state, formAction, pending] = useActionState<BatchFormState, FormData>(createBatch, {});

  return (
    <form
      action={formAction}
      className="max-w-2xl space-y-4 rounded-[14px] border border-stone-200 bg-white p-6"
    >
      <div>
        <label className={label}>Produkt</label>
        <select name="productId" required className={input} defaultValue="">
          <option value="" disabled>
            — vyberte produkt —
          </option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.hasRecipe ? "" : " (bez receptúry!)"}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-stone-500">
          Produkt bez receptúry sa nedá dokončiť — receptúru vytvoríte v sekcii Receptúry.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={label}>Počet kusov</label>
          <input name="producedQty" type="number" min="1" required placeholder="100" className={input} />
        </div>
        <div>
          <label className={label}>Dátum výroby</label>
          <input name="productionDate" type="date" defaultValue={today} required className={input} />
        </div>
        <div>
          <label className={label}>
            Exspirácia <span className="font-normal text-stone-400">(inak podľa potvrdenej trvanlivosti produktu)</span>
          </label>
          <input name="expiryDate" type="date" className={input} />
        </div>
      </div>

      <div>
        <label className={label}>Poznámka</label>
        <input name="note" className={input} />
      </div>

      {state.error && <p className={errorBox}>{state.error}</p>}

      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Ukladám…" : "Vytvoriť šaržu"}
      </button>
    </form>
  );
}
