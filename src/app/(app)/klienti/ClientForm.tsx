"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { ClientFormState } from "./_actions";
import { CompanySearch } from "@/components/CompanySearch";

export interface ClientFormValues {
  type: string;
  name: string;
  ico: string;
  dic: string;
  icDph: string;
  email: string;
  phone: string;
  iban: string;
  street: string;
  city: string;
  zip: string;
  note: string;
}

const EMPTY: ClientFormValues = {
  type: "B2B",
  name: "",
  ico: "",
  dic: "",
  icDph: "",
  email: "",
  phone: "",
  iban: "",
  street: "",
  city: "",
  zip: "",
  note: "",
};

const inputClass =
  "w-full rounded-[10px] border border-stone-300 px-3 py-2 text-sm focus:border-stone-950 focus:outline-none focus:ring-[3px] focus:ring-brand/35";
const labelClass = "mb-1 block text-sm font-medium text-stone-700";

export function ClientForm({
  action,
  initial,
  submitLabel,
  cancelHref,
  showFinanceFields = false,
}: {
  action: (prevState: ClientFormState, formData: FormData) => Promise<ClientFormState>;
  initial?: Partial<ClientFormValues>;
  submitLabel: string;
  cancelHref: string;
  showFinanceFields?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [values, setValues] = useState(() => ({ ...EMPTY, ...initial }));
  const [type, setType] = useState(values.type);
  const [existingClient, setExistingClient] = useState("");

  return (
    <form action={formAction} className="max-w-2xl space-y-5 rounded-[14px] border border-stone-200 bg-white p-6">
      {!initial && type === "B2B" && <CompanySearch onSelect={(company) => {
        if (company.clientId) { setExistingClient(company.clientId); return; }
        setExistingClient("");
        setValues((previous) => ({ ...previous, name: company.name, ico: company.ico, dic: company.dic, icDph: company.icDph, street: company.street, city: company.city, zip: company.zip }));
      }} />}
      {existingClient && <p className="rounded-xl bg-amber-50 p-3 text-sm">Táto firma už je v adresári. <Link href={`/klienti/${existingClient}`} className="font-semibold underline">Otvoriť uloženého klienta</Link><button type="button" className="ml-3 underline" onClick={() => setExistingClient("")}>Pokračovať s novým klientom</button></p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="type" className={labelClass}>Typ klienta</label>
          <select id="type" name="type" value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
            <option value="B2B">B2B — firma</option>
            <option value="B2C">B2C — koncový zákazník</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="name" className={labelClass}>Meno / názov *</label>
          <input id="name" name="name" required value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} className={inputClass} placeholder="Fitko Havran s.r.o." />
        </div>
      </div>

      {type === "B2B" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="ico" className={labelClass}>IČO</label>
            <input id="ico" name="ico" value={values.ico} onChange={(e) => setValues({ ...values, ico: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label htmlFor="dic" className={labelClass}>DIČ</label>
            <input id="dic" name="dic" value={values.dic} onChange={(e) => setValues({ ...values, dic: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label htmlFor="icDph" className={labelClass}>IČ DPH</label>
            <input id="icDph" name="icDph" value={values.icDph} onChange={(e) => setValues({ ...values, icDph: e.target.value })} className={inputClass} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="email" className={labelClass}>E-mail</label>
          <input id="email" name="email" type="email" defaultValue={values.email} className={inputClass} />
        </div>
        <div>
          <label htmlFor="phone" className={labelClass}>Telefón</label>
          <input id="phone" name="phone" defaultValue={values.phone} className={inputClass} placeholder="+421 9xx xxx xxx" />
        </div>
      </div>

      {showFinanceFields && <div>
        <label htmlFor="iban" className={labelClass}>IBAN odberateľa</label>
        <input
          id="iban"
          name="iban"
          defaultValue={values.iban}
          className={inputClass}
          placeholder="SK00 0000 0000 0000 0000 0000"
          autoComplete="off"
        />
        <p className="mt-1 text-xs text-stone-500">
          Používa sa iba ako pomocný údaj pri jednoznačnom párovaní prijatých platieb.
        </p>
      </div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label htmlFor="street" className={labelClass}>Ulica a číslo</label>
          <input id="street" name="street" value={values.street} onChange={(e) => setValues({ ...values, street: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor="city" className={labelClass}>Mesto</label>
          <input id="city" name="city" value={values.city} onChange={(e) => setValues({ ...values, city: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor="zip" className={labelClass}>PSČ</label>
          <input id="zip" name="zip" value={values.zip} onChange={(e) => setValues({ ...values, zip: e.target.value })} className={inputClass} />
        </div>
      </div>

      <div>
        <label htmlFor="note" className={labelClass}>Poznámka</label>
        <textarea id="note" name="note" rows={3} defaultValue={values.note} className={inputClass} />
      </div>

      {state.error && (
        <p className="rounded-[10px] bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending || Boolean(existingClient)}
          className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Ukladám…" : submitLabel}
        </button>
        <Link
          href={cancelHref}
          className="rounded-[10px] border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
        >
          Zrušiť
        </Link>
      </div>
    </form>
  );
}
