"use client";

import { useActionState } from "react";
import { saveFinanceProfile, saveProductVatRates, type InvoiceFormState } from "../_actions";
import { btnPrimary, errorBox, input, label } from "@/components/ui";
import { legalEntityLabels } from "@/lib/zod-schemas";

interface ProfileDefaults {
  legalName: string;
  tradeName: string;
  ico: string;
  dic: string;
  icDph: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  zip: string;
  vatStatus: "NON_PAYER" | "PAYER";
  vatRegisteredFrom: string;
  accountantConfirmed: boolean;
  accountantConfirmedBy: string;
  iban: string;
  bic: string;
}

interface ProductRateDefault {
  id: string;
  name: string;
  rate: number;
  confirmed: boolean;
}

function ResultMessage({ state }: { state: InvoiceFormState }) {
  if (state.error) return <p className={errorBox}>{state.error}</p>;
  if (state.success) {
    return <p className="rounded-[10px] bg-[#E7F8E3] px-3 py-2 text-sm text-[#1F7A0F]">{state.success}</p>;
  }
  return null;
}

export function FinanceSettingsForms({
  profile,
  products,
  suggestedValidFrom,
}: {
  profile: ProfileDefaults;
  products: ProductRateDefault[];
  suggestedValidFrom: string;
}) {
  const [profileState, profileAction, profilePending] = useActionState(saveFinanceProfile, {});
  const [ratesState, ratesAction, ratesPending] = useActionState(saveProductVatRates, {});

  return (
    <div className="space-y-6">
      <form action={profileAction} className="rounded-[14px] border border-stone-200 bg-white p-5">
        <h2 className="mb-1 font-semibold text-stone-950">Firemný a daňový profil</h2>
        <p className="mb-5 text-sm text-stone-500">
          Uloženie vytvorí novú časovo platnú verziu. Staré faktúry zostanú na svojich snapshotoch.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div><label className={label}>Právny subjekt *</label><select name="legalEntity" required defaultValue="" className={input}><option value="" disabled>— vyberte overený subjekt —</option>{Object.entries(legalEntityLabels).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></div>
          <div>
            <label className={label}>Platnosť od</label>
            <input name="validFrom" type="date" required defaultValue={suggestedValidFrom} className={input} />
          </div>
          <div>
            <label className={label}>Obchodné meno</label>
            <input name="legalName" required defaultValue={profile.legalName} className={input} />
          </div>
          <div>
            <label className={label}>Značka / skrátený názov</label>
            <input name="tradeName" defaultValue={profile.tradeName} className={input} />
          </div>
          <div>
            <label className={label}>IČO</label>
            <input name="ico" required defaultValue={profile.ico} className={input} />
          </div>
          <div>
            <label className={label}>DIČ</label>
            <input name="dic" required defaultValue={profile.dic} className={input} />
          </div>
          <div>
            <label className={label}>IČ DPH</label>
            <input name="icDph" defaultValue={profile.icDph} className={input} />
          </div>
          <div>
            <label className={label}>Fakturačný e-mail</label>
            <input name="email" type="email" required defaultValue={profile.email} className={input} />
          </div>
          <div>
            <label className={label}>Telefón</label>
            <input name="phone" defaultValue={profile.phone} className={input} />
          </div>
          <div>
            <label className={label}>Ulica a číslo</label>
            <input name="street" required defaultValue={profile.street} className={input} />
          </div>
          <div>
            <label className={label}>Mesto</label>
            <input name="city" required defaultValue={profile.city} className={input} />
          </div>
          <div>
            <label className={label}>PSČ</label>
            <input name="zip" required defaultValue={profile.zip} className={input} />
          </div>
          <div>
            <label className={label}>Režim DPH</label>
            <select name="vatStatus" defaultValue={profile.vatStatus} className={input}>
              <option value="NON_PAYER">Neplatiteľ DPH</option>
              <option value="PAYER">Platiteľ DPH</option>
            </select>
          </div>
          <div>
            <label className={label}>Dátum registrácie DPH</label>
            <input
              name="vatRegisteredFrom"
              type="date"
              defaultValue={profile.vatRegisteredFrom}
              className={input}
            />
          </div>
          <div>
            <label className={label}>Meno účtovníka, ktorý údaje potvrdil</label>
            <input
              name="accountantConfirmedBy"
              defaultValue={profile.accountantConfirmedBy}
              className={input}
            />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-stone-700 md:col-span-2">
            <input
              name="accountantConfirmed"
              type="checkbox"
              defaultChecked={profile.accountantConfirmed}
              className="size-4"
            />
            Účtovník potvrdil režim a dátum registrácie DPH
          </label>
          <div>
            <label className={label}>Primárny EUR IBAN</label>
            <input name="iban" required defaultValue={profile.iban} className={input} />
          </div>
          <div>
            <label className={label}>BIC / SWIFT</label>
            <input name="bic" defaultValue={profile.bic} className={input} />
          </div>
        </div>
        <div className="mt-5 space-y-3">
          <button type="submit" disabled={profilePending} className={btnPrimary}>
            {profilePending ? "Ukladám…" : "Uložiť novú verziu profilu"}
          </button>
          <ResultMessage state={profileState} />
        </div>
      </form>

      <form action={ratesAction} className="rounded-[14px] border border-stone-200 bg-white p-5">
        <h2 className="mb-1 font-semibold text-stone-950">Sadzby DPH produktov</h2>
        <p className="mb-5 text-sm text-stone-500">
          Finalizácia vydanej faktúry je zablokovaná, kým každý použitý produkt nemá potvrdenú sadzbu.
        </p>
        <div className="mb-4 max-w-xs">
          <label className={label}>Platnosť sadzieb od</label>
          <input name="validFrom" type="date" required defaultValue={suggestedValidFrom} className={input} />
        </div>
        <div className="overflow-x-auto rounded-[10px] border border-stone-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase text-stone-500">
                <th className="px-4 py-3">Produkt</th>
                <th className="px-4 py-3">Sadzba %</th>
                <th className="px-4 py-3">Potvrdené účtovníkom</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-stone-900">{product.name}</td>
                  <td className="px-4 py-3">
                    <input
                      name={`rate:${product.id}`}
                      type="number"
                      min={0}
                      max={100}
                      required
                      defaultValue={product.rate}
                      className="w-24 rounded-[8px] border border-stone-300 px-2 py-1.5"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      name={`confirmed:${product.id}`}
                      type="checkbox"
                      defaultChecked={product.confirmed}
                      className="size-4"
                    />
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-stone-400">
                    Nie sú vytvorené žiadne aktívne produkty.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-5 space-y-3">
          <button type="submit" disabled={ratesPending || products.length === 0} className={btnPrimary}>
            {ratesPending ? "Ukladám…" : "Uložiť sadzby"}
          </button>
          <ResultMessage state={ratesState} />
        </div>
      </form>
    </div>
  );
}
