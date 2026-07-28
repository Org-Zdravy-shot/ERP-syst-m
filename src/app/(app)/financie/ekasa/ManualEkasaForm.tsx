"use client";

import { useActionState } from "react";
import { createManualEkasaSale, type InvoiceFormState } from "../_actions";
import { btnPrimary, errorBox, input, label } from "@/components/ui";

export function ManualEkasaForm() {
  const [state, formAction, pending] = useActionState<InvoiceFormState, FormData>(
    createManualEkasaSale,
    {},
  );

  return (
    <div className="rounded-[14px] border border-stone-200 bg-white p-5">
      <h2 className="mb-1 font-semibold text-stone-900">Manuálne pridanie položky dokladu</h2>
      <p className="mb-4 text-sm text-stone-500">
        Záloha pre doklady, ktoré nie sú v reporte. Pri viacpoložkovom doklade pridajte každú
        položku samostatne s rovnakým identifikátorom dokladu.
      </p>

      <form action={formAction} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="ekasa-sale-date">
            Dátum a čas
          </label>
          <input id="ekasa-sale-date" name="saleDate" type="datetime-local" required className={input} />
        </div>
        <div>
          <label className={label} htmlFor="ekasa-receipt">
            Identifikátor dokladu
          </label>
          <input
            id="ekasa-receipt"
            name="receiptNumber"
            placeholder="napr. V-ABC123…"
            required
            className={input}
          />
        </div>
        <div>
          <label className={label} htmlFor="ekasa-description">
            Tovar alebo služba
          </label>
          <input id="ekasa-description" name="description" required className={input} />
        </div>
        <div>
          <label className={label} htmlFor="ekasa-product-code">
            Kód tovaru (nepovinný)
          </label>
          <input id="ekasa-product-code" name="productCode" placeholder="napr. ZS-KLA-200" className={input} />
        </div>
        <div>
          <label className={label} htmlFor="ekasa-quantity">
            Množstvo
          </label>
          <input
            id="ekasa-quantity"
            name="quantity"
            type="number"
            min="0.001"
            step="0.001"
            defaultValue="1"
            required
            className={input}
          />
        </div>
        <div>
          <label className={label} htmlFor="ekasa-gross">
            Suma položky s DPH (€)
          </label>
          <input
            id="ekasa-gross"
            name="totalGross"
            type="number"
            step="0.01"
            placeholder="10,50"
            required
            className={input}
          />
        </div>
        <div>
          <label className={label} htmlFor="ekasa-item-type">
            Typ položky
          </label>
          <select id="ekasa-item-type" name="itemType" defaultValue="kladná" className={input}>
            <option value="kladná">Kladná</option>
            <option value="vrátenie tovaru">Vrátenie tovaru</option>
            <option value="oprava">Oprava</option>
            <option value="odpočítaná záloha">Odpočítaná záloha</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="ekasa-vat">
            DPH (nepovinná)
          </label>
          <select id="ekasa-vat" name="vatRate" defaultValue="" className={input}>
            <option value="">Nezadaná</option>
            <option value="0">0 %</option>
            <option value="5">5 %</option>
            <option value="10">10 %</option>
            <option value="19">19 %</option>
            <option value="20">20 %</option>
            <option value="23">23 %</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <button type="submit" disabled={pending} className={btnPrimary}>
            {pending ? "Ukladám…" : "Pridať položku"}
          </button>
          {state.error && <p className={`${errorBox} mt-3`}>{state.error}</p>}
          {state.success && (
            <p className="mt-3 rounded-[10px] bg-[#E7F8E3] px-3 py-2 text-sm text-[#1F7A0F]">
              {state.success}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
