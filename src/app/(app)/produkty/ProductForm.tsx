"use client";

import { useActionState } from "react";
import Link from "next/link";
import { btnPrimary, btnSecondary, card, errorBox, input, label } from "@/components/ui";
import type { ProductFormState } from "./_actions";

export interface ProductValues {
  sku: string;
  name: string;
  volumeMl: number | null;
  priceB2cCents: number;
  priceB2bCents: number | null;
  vatRate: number;
  shelfLifeDays: number;
  isActive: boolean;
}

function euros(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

export function ProductForm({ action, product }: {
  action: (previous: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  product?: ProductValues;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={`${card} max-w-2xl space-y-5 p-6`}>
      {state.error && <p role="alert" className={errorBox}>{state.error}</p>}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="sku">Kód produktu (SKU) *</label>
          <input className={input} id="sku" name="sku" maxLength={80} required defaultValue={product?.sku} placeholder="napr. ZS-PAS-KLA-060" />
        </div>
        <div>
          <label className={label} htmlFor="volumeMl">Objem v ml</label>
          <input className={input} id="volumeMl" name="volumeMl" type="number" min="1" step="1" defaultValue={product?.volumeMl ?? ""} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="name">Názov produktu *</label>
        <input className={input} id="name" name="name" maxLength={200} required defaultValue={product?.name} placeholder="napr. Pasterizovaný zázvorový shot 60 ml" />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="priceB2c">Predajná cena za kus (€) *</label>
          <input className={input} id="priceB2c" name="priceB2c" inputMode="decimal" required defaultValue={euros(product?.priceB2cCents ?? null)} placeholder="3,50" />
        </div>
        <div>
          <label className={label} htmlFor="priceB2b">Predvolená B2B cena (€)</label>
          <input className={input} id="priceB2b" name="priceB2b" inputMode="decimal" defaultValue={euros(product?.priceB2bCents ?? null)} placeholder="Voliteľné" />
          <p className="mt-1 text-xs text-stone-500">Cena konkrétneho klienta má prednosť.</p>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="vatRate">Sadzba DPH (%) *</label>
          <input className={input} id="vatRate" name="vatRate" type="number" min="0" max="100" step="1" required defaultValue={product?.vatRate ?? 0} />
          <p className="mt-1 text-xs text-stone-500">Zadajte sadzbu platnú pre tento produkt.</p>
        </div>
        <div>
          <label className={label} htmlFor="shelfLifeDays">Trvanlivosť v dňoch *</label>
          <input className={input} id="shelfLifeDays" name="shelfLifeDays" type="number" min="1" step="1" required defaultValue={product?.shelfLifeDays ?? 30} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input type="checkbox" name="isActive" defaultChecked={product?.isActive ?? true} />
        Aktívny produkt — ponúkať pri vytváraní objednávky
      </label>
      <p className="text-xs text-stone-500">Založenie produktu nevytvára receptúru, šaržu ani skladové zásoby. Expedícia vyžaduje dostatok kusov na sklade.</p>
      <div className="flex gap-2">
        <button className={btnPrimary} type="submit" disabled={pending}>{pending ? "Ukladá sa…" : product ? "Uložiť zmeny" : "Vytvoriť produkt"}</button>
        <Link href="/produkty" className={btnSecondary}>Späť na produkty</Link>
      </div>
    </form>
  );
}
