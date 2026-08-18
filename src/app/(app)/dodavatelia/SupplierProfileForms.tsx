"use client";

import { useActionState } from "react";
import {
  createSupplierBankAccount,
  createSupplierContact,
  createSupplierLocation,
  type SupplierInlineFormState,
} from "./_actions";
import { btnSmallPrimary, errorBox, input, labelSmall } from "@/components/ui";

function Feedback({ state }: { state: SupplierInlineFormState }) {
  if (state.error) return <p className={`${errorBox} mt-3`}>{state.error}</p>;
  if (state.success) return <p className="mt-3 rounded-[10px] bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.success}</p>;
  return null;
}

export function SupplierContactForm({ supplierId }: { supplierId: string }) {
  const action = createSupplierContact.bind(null, supplierId);
  const [state, formAction, pending] = useActionState<SupplierInlineFormState, FormData>(action, {});
  return (
    <details className="border-t border-stone-100 px-5 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-stone-700">+ Pridať kontaktnú osobu</summary>
      <form action={formAction} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelSmall}>Meno *</label>
          <input name="name" required maxLength={255} className={input} />
        </div>
        <div>
          <label className={labelSmall}>Rola</label>
          <input name="role" maxLength={255} placeholder="obchod, fakturácia…" className={input} />
        </div>
        <div>
          <label className={labelSmall}>E-mail</label>
          <input name="email" type="email" maxLength={320} className={input} />
        </div>
        <div>
          <label className={labelSmall}>Telefón</label>
          <input name="phone" type="tel" maxLength={50} className={input} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelSmall}>Poznámka</label>
          <input name="note" maxLength={5_000} className={input} />
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input name="isPrimary" type="checkbox" /> Hlavný kontakt
        </label>
        <div className="flex justify-end">
          <button disabled={pending} className={btnSmallPrimary}>{pending ? "Ukladám…" : "Pridať kontakt"}</button>
        </div>
        <div className="sm:col-span-2"><Feedback state={state} /></div>
      </form>
    </details>
  );
}

export function SupplierLocationForm({ supplierId }: { supplierId: string }) {
  const action = createSupplierLocation.bind(null, supplierId);
  const [state, formAction, pending] = useActionState<SupplierInlineFormState, FormData>(action, {});
  return (
    <details className="border-t border-stone-100 px-5 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-stone-700">+ Pridať miesto</summary>
      <form action={formAction} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelSmall}>Typ</label>
          <select name="type" defaultValue="PICKUP" className={input}>
            <option value="REGISTERED">Sídlo</option>
            <option value="WAREHOUSE">Sklad</option>
            <option value="PICKUP">Osobný odber</option>
            <option value="BILLING">Fakturačná adresa</option>
            <option value="OTHER">Iné miesto</option>
          </select>
        </div>
        <div>
          <label className={labelSmall}>Názov *</label>
          <input name="name" required maxLength={255} placeholder="Hlavný sklad" className={input} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelSmall}>Ulica</label>
          <input name="street" maxLength={255} className={input} />
        </div>
        <div>
          <label className={labelSmall}>Mesto</label>
          <input name="city" maxLength={255} className={input} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className={labelSmall}>PSČ</label>
            <input name="zip" maxLength={20} className={input} />
          </div>
          <div>
            <label className={labelSmall}>Krajina</label>
            <input name="country" maxLength={2} defaultValue="SK" className={input} />
          </div>
        </div>
        <div>
          <label className={labelSmall}>Otváracie hodiny</label>
          <input name="openingHours" maxLength={1_000} className={input} />
        </div>
        <div>
          <label className={labelSmall}>Pokyny k doprave alebo odberu</label>
          <input name="deliveryInstructions" maxLength={5_000} className={input} />
        </div>
        <details className="sm:col-span-2 rounded-[10px] bg-stone-50 p-3">
          <summary className="cursor-pointer text-xs font-medium text-stone-500">Voliteľné GPS súradnice</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <input name="latitude" inputMode="decimal" placeholder="48,1486" className={input} />
            <input name="longitude" inputMode="decimal" placeholder="17,1077" className={input} />
          </div>
        </details>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input name="isPrimary" type="checkbox" /> Hlavné miesto
        </label>
        <div className="flex justify-end">
          <button disabled={pending} className={btnSmallPrimary}>{pending ? "Ukladám…" : "Pridať miesto"}</button>
        </div>
        <div className="sm:col-span-2"><Feedback state={state} /></div>
      </form>
    </details>
  );
}

export function SupplierBankAccountForm({ supplierId }: { supplierId: string }) {
  const action = createSupplierBankAccount.bind(null, supplierId);
  const [state, formAction, pending] = useActionState<SupplierInlineFormState, FormData>(action, {});
  return (
    <details className="border-t border-stone-100 px-5 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-stone-700">+ Pridať bankový účet</summary>
      <form action={formAction} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelSmall}>Názov účtu</label>
          <input name="name" maxLength={255} placeholder="Hlavný účet" className={input} />
        </div>
        <div>
          <label className={labelSmall}>BIC/SWIFT</label>
          <input name="bic" maxLength={20} className={input} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelSmall}>IBAN *</label>
          <input name="iban" required maxLength={34} className={input} />
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input name="isPrimary" type="checkbox" /> Hlavný účet
        </label>
        <div className="flex justify-end">
          <button disabled={pending} className={btnSmallPrimary}>{pending ? "Ukladám…" : "Pridať účet"}</button>
        </div>
        <div className="sm:col-span-2"><Feedback state={state} /></div>
      </form>
    </details>
  );
}
