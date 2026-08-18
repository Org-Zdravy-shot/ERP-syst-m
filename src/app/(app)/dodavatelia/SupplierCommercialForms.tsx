"use client";

import { useActionState } from "react";
import {
  createSupplierAccountEntry,
  createSupplierCatalogItem,
  createSupplierPrice,
  createSupplierReturnableMovement,
  createSupplierReturnableType,
  linkSupplierInvoice,
  type SupplierCommercialFormState,
} from "./_commercial-actions";
import { btnSmallPrimary, errorBox, input, labelSmall } from "@/components/ui";

type StockOption = { id: string; name: string; unit: string };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function Feedback({ state }: { state: SupplierCommercialFormState }) {
  if (state.error) return <p className={`${errorBox} mt-3`}>{state.error}</p>;
  if (state.success) return <p className="mt-3 rounded-[10px] bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.success}</p>;
  return null;
}

export function SupplierCatalogItemForm({
  supplierId,
  materials,
  products,
}: {
  supplierId: string;
  materials: StockOption[];
  products: StockOption[];
}) {
  const action = createSupplierCatalogItem.bind(null, supplierId);
  const [state, formAction, pending] = useActionState<SupplierCommercialFormState, FormData>(action, {});
  return (
    <details className="border-t border-stone-100 px-5 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-stone-700">+ Pridať ponuku dodávateľa</summary>
      <form action={formAction} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className={labelSmall}>Väzba na sklad</label>
          <select name="itemRef" defaultValue="service" className={input}>
            <option value="service">Služba / bez skladovej väzby</option>
            <optgroup label="Suroviny">
              {materials.map((material) => <option key={material.id} value={`material:${material.id}`}>{material.name} ({material.unit})</option>)}
            </optgroup>
            <optgroup label="Hotové produkty">
              {products.map((product) => <option key={product.id} value={`product:${product.id}`}>{product.name} ({product.unit})</option>)}
            </optgroup>
          </select>
        </div>
        <div>
          <label className={labelSmall}>Názov ponuky *</label>
          <input name="name" required maxLength={255} placeholder="Med kvetový 30 kg" className={input} />
        </div>
        <div>
          <label className={labelSmall}>Dodávateľské SKU</label>
          <input name="supplierSku" maxLength={255} className={input} />
        </div>
        <div>
          <label className={labelSmall}>Jednotka</label>
          <select name="unit" defaultValue="kg" className={input}>
            <option value="ks">ks</option><option value="kg">kg</option><option value="l">l</option>
            <option value="g">g</option><option value="ml">ml</option>
          </select>
        </div>
        <div>
          <label className={labelSmall}>Balenie</label>
          <input name="packQuantity" required inputMode="decimal" defaultValue="1" className={input} />
        </div>
        <div>
          <label className={labelSmall}>Minimálny odber</label>
          <input name="minOrderQuantity" required inputMode="decimal" defaultValue="0" className={input} />
        </div>
        <div>
          <label className={labelSmall}>Objednávkový násobok</label>
          <input name="orderMultiple" required inputMode="decimal" defaultValue="1" className={input} />
        </div>
        <div>
          <label className={labelSmall}>Dodacia doba v dňoch</label>
          <input name="leadTimeDays" type="number" min={0} max={3650} required defaultValue="0" className={input} />
        </div>
        <div>
          <label className={labelSmall}>Krajina pôvodu</label>
          <input name="originCountry" maxLength={2} placeholder="SK" className={input} />
        </div>
        <div className="md:col-span-2">
          <label className={labelSmall}>Kvalita / certifikáty</label>
          <input name="qualityNote" maxLength={5_000} placeholder="BIO, šarže, analýzy…" className={input} />
        </div>
        <div>
          <label className={labelSmall}>Poznámka</label>
          <input name="note" maxLength={5_000} className={input} />
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input name="isPreferred" type="checkbox" /> Preferovaná ponuka pre položku
        </label>
        <div className="flex justify-end md:col-span-2">
          <button disabled={pending} className={btnSmallPrimary}>{pending ? "Ukladám…" : "Pridať ponuku"}</button>
        </div>
        <div className="md:col-span-3"><Feedback state={state} /></div>
      </form>
    </details>
  );
}

export function SupplierPriceForm({ supplierId, catalogItemId }: { supplierId: string; catalogItemId: string }) {
  const action = createSupplierPrice.bind(null, supplierId, catalogItemId);
  const [state, formAction, pending] = useActionState<SupplierCommercialFormState, FormData>(action, {});
  return (
    <details className="mt-3 rounded-[10px] bg-stone-50 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-stone-600">+ Nová cena</summary>
      <form action={formAction} className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div>
          <label className={labelSmall}>Cena € *</label>
          <input name="unitPrice" required inputMode="decimal" placeholder="4,50" className={input} />
        </div>
        <div>
          <label className={labelSmall}>Za množstvo</label>
          <input name="pricePerQuantity" required inputMode="decimal" defaultValue="1" className={input} />
        </div>
        <div>
          <label className={labelSmall}>Od množstva</label>
          <input name="minimumQuantity" required inputMode="decimal" defaultValue="0" className={input} />
        </div>
        <div>
          <label className={labelSmall}>Typ ceny</label>
          <select name="priceType" defaultValue="NET" className={input}><option value="NET">bez DPH</option><option value="GROSS">s DPH</option></select>
        </div>
        <div>
          <label className={labelSmall}>DPH %</label>
          <input name="vatRate" type="number" min={0} max={100} placeholder="23" className={input} />
        </div>
        <div>
          <label className={labelSmall}>Platí od *</label>
          <input name="validFrom" type="date" required defaultValue={today()} className={input} />
        </div>
        <div>
          <label className={labelSmall}>Platí do</label>
          <input name="validTo" type="date" className={input} />
        </div>
        <div>
          <label className={labelSmall}>Poznámka</label>
          <input name="note" maxLength={5_000} className={input} />
        </div>
        <div className="col-span-2 flex justify-end lg:col-span-4">
          <button disabled={pending} className={btnSmallPrimary}>{pending ? "Ukladám…" : "Uložiť novú cenu"}</button>
        </div>
        <div className="col-span-2 lg:col-span-4"><Feedback state={state} /></div>
      </form>
    </details>
  );
}

export function SupplierReturnableTypeForm({
  supplierId,
  canSetDeposit,
}: {
  supplierId: string;
  canSetDeposit: boolean;
}) {
  const action = createSupplierReturnableType.bind(null, supplierId);
  const [state, formAction, pending] = useActionState<SupplierCommercialFormState, FormData>(action, {});
  return (
    <details className="border-t border-stone-100 px-5 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-stone-700">+ Pridať typ vratného obalu</summary>
      <form action={formAction} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className={labelSmall}>Názov *</label><input name="name" required maxLength={255} placeholder="30 kg nádoba na med" className={input} /></div>
        <div><label className={labelSmall}>Vlastník</label><select name="owner" defaultValue="SUPPLIER" className={input}><option value="SUPPLIER">Patrí dodávateľovi — držíme my</option><option value="COMPANY">Patrí nám — drží dodávateľ</option></select></div>
        <div><label className={labelSmall}>Jednotka</label><select name="unit" defaultValue="ks" className={input}><option value="ks">ks</option><option value="kg">kg</option><option value="l">l</option><option value="g">g</option><option value="ml">ml</option></select></div>
        {canSetDeposit && <div><label className={labelSmall}>Depozit za kus €</label><input name="deposit" inputMode="decimal" placeholder="0,00" className={input} /></div>}
        <div><label className={labelSmall}>Bežná lehota vrátenia</label><input name="expectedReturnDays" type="number" min={1} max={3650} placeholder="365" className={input} /></div>
        <div><label className={labelSmall}>Pripomienka</label><input name="reminderNote" maxLength={5_000} className={input} /></div>
        <div className="sm:col-span-2 flex justify-end"><button disabled={pending} className={btnSmallPrimary}>{pending ? "Ukladám…" : "Pridať obal"}</button></div>
        <div className="sm:col-span-2"><Feedback state={state} /></div>
      </form>
    </details>
  );
}

export function SupplierReturnableMovementForm({
  supplierId,
  typeId,
  owner,
  unit,
}: {
  supplierId: string;
  typeId: string;
  owner: string;
  unit: string;
}) {
  const action = createSupplierReturnableMovement.bind(null, supplierId, typeId);
  const [state, formAction, pending] = useActionState<SupplierCommercialFormState, FormData>(action, {});
  const increase = owner === "SUPPLIER" ? "Prevzali sme od dodávateľa" : "Dodávateľ prevzal od nás";
  const decrease = owner === "SUPPLIER" ? "Vrátili sme dodávateľovi" : "Dodávateľ vrátil nám";
  return (
    <details className="mt-2 rounded-lg bg-stone-50 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-stone-600">+ Zapísať pohyb</summary>
      <form action={formAction} className="mt-3 grid grid-cols-2 gap-2">
        <div className="col-span-2"><label className={labelSmall}>Čo sa stalo</label><select name="direction" className={input}><option value="INCREASE">{increase}</option><option value="DECREASE">{decrease}</option></select></div>
        <div><label className={labelSmall}>Množstvo ({unit})</label><input name="quantity" required inputMode="decimal" className={input} /></div>
        <div><label className={labelSmall}>Dátum</label><input name="occurredAt" type="date" required defaultValue={today()} className={input} /></div>
        <div><label className={labelSmall}>Vrátiť do</label><input name="dueDate" type="date" className={input} /></div>
        <div><label className={labelSmall}>Referencia</label><input name="reference" maxLength={255} placeholder="dodací list" className={input} /></div>
        <div className="col-span-2"><label className={labelSmall}>Poznámka</label><input name="note" maxLength={5_000} className={input} /></div>
        <div className="col-span-2 flex justify-end"><button disabled={pending} className={btnSmallPrimary}>{pending ? "Ukladám…" : "Uložiť pohyb"}</button></div>
        <div className="col-span-2"><Feedback state={state} /></div>
      </form>
    </details>
  );
}

export function SupplierAccountEntryForm({ supplierId }: { supplierId: string }) {
  const action = createSupplierAccountEntry.bind(null, supplierId);
  const [state, formAction, pending] = useActionState<SupplierCommercialFormState, FormData>(action, {});
  return (
    <details className="border-t border-stone-100 px-5 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-stone-700">+ Pridať iný záväzok, kredit alebo depozit</summary>
      <form action={formAction} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><label className={labelSmall}>Smer</label><select name="direction" className={input}><option value="WE_OWE">My dlžíme dodávateľovi</option><option value="THEY_OWE">Dodávateľ dlží nám</option></select></div>
        <div><label className={labelSmall}>Typ</label><select name="type" className={input}><option value="OPENING_BALANCE">Počiatočný stav</option><option value="DEPOSIT">Depozit</option><option value="CREDIT">Kredit alebo zápočet</option><option value="ADJUSTMENT">Korekcia</option><option value="OTHER">Iné</option></select></div>
        <div><label className={labelSmall}>Suma € *</label><input name="amount" required inputMode="decimal" className={input} /></div>
        <div><label className={labelSmall}>Dátum</label><input name="occurredAt" type="date" required defaultValue={today()} className={input} /></div>
        <div><label className={labelSmall}>Splatnosť</label><input name="dueDate" type="date" className={input} /></div>
        <div><label className={labelSmall}>Referencia</label><input name="reference" maxLength={255} className={input} /></div>
        <div className="sm:col-span-3"><label className={labelSmall}>Poznámka</label><input name="note" maxLength={5_000} className={input} /></div>
        <div className="sm:col-span-3 flex justify-end"><button disabled={pending} className={btnSmallPrimary}>{pending ? "Ukladám…" : "Uložiť finančný pohyb"}</button></div>
        <div className="sm:col-span-3"><Feedback state={state} /></div>
      </form>
    </details>
  );
}

export function SupplierInvoiceLinkForm({
  supplierId,
  invoices,
}: {
  supplierId: string;
  invoices: Array<{ id: string; label: string }>;
}) {
  const action = linkSupplierInvoice.bind(null, supplierId);
  const [state, formAction, pending] = useActionState<SupplierCommercialFormState, FormData>(action, {});
  if (invoices.length === 0) return null;
  return (
    <details className="border-t border-stone-100 px-5 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-stone-700">+ Priradiť existujúcu prijatú faktúru</summary>
      <form action={formAction} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <select name="invoiceId" required defaultValue="" className={input}>
          <option value="" disabled>Vyberte faktúru…</option>
          {invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.label}</option>)}
        </select>
        <button disabled={pending} className={btnSmallPrimary}>{pending ? "Priraďujem…" : "Priradiť"}</button>
      </form>
      <Feedback state={state} />
    </details>
  );
}
