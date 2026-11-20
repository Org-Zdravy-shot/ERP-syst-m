"use client";

import { useId, useState } from "react";
import { CompanySearch } from "@/components/CompanySearch";
import { btnSmall, input, label } from "@/components/ui";
import type { CompanyMatch } from "@/lib/company-lookup";
import { saveInvoiceClient } from "../../../klienti/company-actions";

interface ClientOption { id: string; name: string; type: string }
type BillingFields = Pick<CompanyMatch, "name" | "ico" | "dic" | "icDph" | "street" | "city" | "zip" | "country">;
const EMPTY: BillingFields = { name: "", ico: "", dic: "", icDph: "", street: "", city: "", zip: "", country: "SK" };
const FIELDS = [
  ["name", "Názov firmy", 255], ["ico", "IČO", 8], ["dic", "DIČ", 10], ["icDph", "IČ DPH", 12],
  ["street", "Ulica a číslo", 255], ["city", "Mesto", 120], ["zip", "PSČ", 20],
] as const;

export function InvoiceCustomerPicker({ clients, onSavingChange }: { clients: ClientOption[]; onSavingChange: (saving: boolean) => void }) {
  const id = useId();
  const [options, setOptions] = useState(clients);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<BillingFields | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function choose(company: CompanyMatch) {
    setError("");
    if (company.clientId) {
      const clientId = company.clientId;
      setOptions((previous) => previous.some((row) => row.id === clientId) ? previous : [...previous, { id: clientId, name: company.name, type: "B2B" }]);
      setSelected(clientId); setDraft(null);
    } else {
      setSelected(""); setDraft(company);
    }
  }

  async function save() {
    if (!draft || saving) return;
    setSaving(true); onSavingChange(true); setError("");
    try {
      const result = await saveInvoiceClient(draft);
      if (!result.client) { setError(result.error ?? "Klienta sa nepodarilo uložiť."); return; }
      const client = result.client;
      setOptions((previous) => previous.some((row) => row.id === client.id) ? previous : [...previous, client]);
      setSelected(client.id); setDraft(null);
    } catch { setError("Klienta sa nepodarilo uložiť. Skúste to znova."); }
    finally { setSaving(false); onSavingChange(false); }
  }

  return <div className="space-y-3">
    <fieldset disabled={saving} className="space-y-3">
      <CompanySearch onSelect={choose} />
      <div>
        <label htmlFor={`${id}-client`} className={label}>Odberateľ *</label>
        <select id={`${id}-client`} name="clientId" required className={input} value={selected} onChange={(event) => { setSelected(event.target.value); setDraft(null); setError(""); }}>
          <option value="" disabled>— vyberte klienta —</option>
          {options.map((client) => <option key={client.id} value={client.id}>{client.name} ({client.type})</option>)}
        </select>
      </div>
      {!draft && <button type="button" className={btnSmall} onClick={() => { setDraft({ ...EMPTY }); setSelected(""); setError(""); }}>+ Zadať novú firmu ručne</button>}
      {draft && <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4">
        <p className="text-sm font-semibold">Fakturačné údaje novej firmy</p>
        <p className="text-xs text-stone-600">Skontrolujte údaje a uložte firmu medzi klientov. Rozpísaná faktúra zostane zachovaná.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map(([key, title, maxLength]) => <div key={key} className={key === "name" ? "sm:col-span-2 lg:col-span-3" : ""}>
            <label htmlFor={`${id}-${key}`} className={label}>{title}{key === "name" || key === "ico" ? " *" : ""}</label>
            <input id={`${id}-${key}`} className={input} value={draft[key]} maxLength={maxLength} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
          </div>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSmall} onClick={save}>{saving ? "Ukladám firmu…" : "Uložiť a vybrať firmu"}</button>
          <button type="button" className={btnSmall} onClick={() => { setDraft(null); setError(""); }}>Zrušiť pridanie</button>
        </div>
      </div>}
    </fieldset>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
