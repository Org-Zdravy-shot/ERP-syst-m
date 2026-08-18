"use client";

import { useActionState } from "react";
import type { SupplierFormState } from "./_actions";
import { btnPrimary, btnSecondary, errorBox, input, label } from "@/components/ui";

type SupplierFormAction = (
  previous: SupplierFormState,
  formData: FormData,
) => Promise<SupplierFormState>;

export interface SupplierFormValues {
  kind?: string;
  name?: string;
  legalName?: string | null;
  ico?: string | null;
  dic?: string | null;
  icDph?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  paymentTermsDays?: number;
  source?: string;
  sourceDetail?: string | null;
  rating?: number | null;
  note?: string | null;
  tags?: string[];
}

export function SupplierForm({
  action,
  initial = {},
  submitLabel,
}: {
  action: SupplierFormAction;
  initial?: SupplierFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<SupplierFormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-6">
      <section className="rounded-[14px] border border-stone-200 bg-white p-5">
        <h2 className="mb-4 font-semibold text-stone-950">Základné údaje</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={label}>Typ</label>
            <select name="kind" defaultValue={initial.kind ?? "COMPANY"} className={input}>
              <option value="COMPANY">Firma</option>
              <option value="PERSON">Fyzická osoba</option>
            </select>
          </div>
          <div>
            <label className={label}>Názov *</label>
            <input name="name" required maxLength={255} defaultValue={initial.name ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Právny názov</label>
            <input name="legalName" maxLength={255} defaultValue={initial.legalName ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Štítky</label>
            <input
              name="tags"
              maxLength={1_000}
              defaultValue={initial.tags?.join(", ") ?? ""}
              placeholder="med, ovocie, obaly"
              className={input}
            />
            <p className="mt-1 text-xs text-stone-400">Oddeľte čiarkou.</p>
          </div>
          <div>
            <label className={label}>IČO</label>
            <input name="ico" maxLength={20} defaultValue={initial.ico ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>DIČ</label>
            <input name="dic" maxLength={20} defaultValue={initial.dic ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>IČ DPH</label>
            <input name="icDph" maxLength={24} defaultValue={initial.icDph ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Hodnotenie</label>
            <select name="rating" defaultValue={initial.rating?.toString() ?? ""} className={input}>
              <option value="">Bez hodnotenia</option>
              <option value="5">5 — výborný</option>
              <option value="4">4 — veľmi dobrý</option>
              <option value="3">3 — priemerný</option>
              <option value="2">2 — slabší</option>
              <option value="1">1 — problémový</option>
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-[14px] border border-stone-200 bg-white p-5">
        <h2 className="mb-4 font-semibold text-stone-950">Kontakt a pôvod</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={label}>Všeobecný e-mail</label>
            <input name="email" type="email" maxLength={320} defaultValue={initial.email ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Telefón</label>
            <input name="phone" type="tel" maxLength={50} defaultValue={initial.phone ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Web</label>
            <input
              name="website"
              type="url"
              maxLength={2_048}
              defaultValue={initial.website ?? ""}
              placeholder="https://"
              className={input}
            />
          </div>
          <div>
            <label className={label}>Splatnosť faktúr v dňoch</label>
            <input
              name="paymentTermsDays"
              type="number"
              min={0}
              max={3650}
              required
              defaultValue={initial.paymentTermsDays ?? 14}
              className={input}
            />
          </div>
          <div>
            <label className={label}>Odkiaľ dodávateľa máme</label>
            <select name="source" defaultValue={initial.source ?? "OTHER"} className={input}>
              <option value="REFERRAL">Odporúčanie</option>
              <option value="WEB">Web</option>
              <option value="FAIR">Veľtrh alebo podujatie</option>
              <option value="MARKETPLACE">Trhovisko</option>
              <option value="EXISTING">Existujúci kontakt</option>
              <option value="OTHER">Iné</option>
            </select>
          </div>
          <div>
            <label className={label}>Detail zdroja</label>
            <input
              name="sourceDetail"
              maxLength={255}
              defaultValue={initial.sourceDetail ?? ""}
              placeholder="Kto odporučil, názov podujatia…"
              className={input}
            />
          </div>
          <div className="md:col-span-2">
            <label className={label}>Interná poznámka</label>
            <textarea name="note" maxLength={5_000} rows={5} defaultValue={initial.note ?? ""} className={input} />
          </div>
        </div>
      </section>

      {state.error && <p className={errorBox}>{state.error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Ukladám…" : submitLabel}
        </button>
        <a href="/dodavatelia" className={btnSecondary}>Zrušiť</a>
      </div>
    </form>
  );
}
