"use client";

import { useActionState, useState } from "react";
import { recordHistoricalInvoice } from "../../_actions";
import { legalEntityLabels } from "@/lib/zod-schemas";
import { btnPrimary, input, label } from "@/components/ui";

export function HistoricalInvoiceForm() {
  const [state, action, pending] = useActionState(recordHistoricalInvoice, {});
  const [review, setReview] = useState(false);
  const [summary, setSummary] = useState<Record<string, string>>({});
  return <form action={action} onSubmit={(event) => {
    if (review) return;
    event.preventDefault();
    const values = Object.fromEntries([...new FormData(event.currentTarget)].map(([key, value]) => [key, String(value)]));
    setSummary(values); setReview(true);
  }} className="max-w-4xl space-y-5 rounded-[14px] border border-stone-200 bg-white p-6">
    <input type="hidden" name="confirmDuplicate" value={state.duplicateFingerprint ?? ""} />
    <p className="text-sm text-stone-600">Zadajte daňové sumy a sumu na úhradu presne podľa originálu. Ich meny sa môžu líšiť. Potvrdenie úhrady je evidenčný údaj. Po uložení priložte originálny PDF alebo obrázok na stránke dokladu.</p>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div><label className={label}>Smer *</label><select name="direction" required defaultValue="PRIJATA" className={input} onChange={() => setReview(false)}><option value="PRIJATA">Prijatá</option><option value="VYDANA">Vydaná</option></select></div>
      <div><label className={label}>Právny subjekt odberateľa / vystaviteľa *</label><select name="legalEntity" required defaultValue="" className={input} onChange={() => setReview(false)}><option value="" disabled>— vyberte —</option>{Object.entries(legalEntityLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></div>
      <div><label className={label}>Typ originálu *</label><select name="historicalKind" defaultValue="FINAL" className={input} onChange={() => setReview(false)}><option value="FINAL">Konečná faktúra</option><option value="PROFORMA">Predfaktúra</option></select></div>
      <div><label className={label}>Dodávateľ / odberateľ *</label><input name="partnerName" required className={input} onChange={() => setReview(false)} /></div>
      <div><label className={label}>Pôvodné číslo dokladu *</label><input name="externalNumber" required className={input} onChange={() => setReview(false)} /></div>
      <div><label className={label}>Variabilný symbol</label><input name="variableSymbol" className={input} onChange={() => setReview(false)} /></div>
      <div><label className={label}>Dátum vystavenia *</label><input name="issueDate" type="date" required className={input} onChange={() => setReview(false)} /></div>
      <div><label className={label}>Dátum splatnosti *</label><input name="dueDate" type="date" required className={input} onChange={() => setReview(false)} /></div>
      <div><label className={label}>Dátum dodania / zdaniteľného plnenia</label><input name="deliveryDate" type="date" className={input} onChange={() => setReview(false)} /></div>
      <div><label className={label}>Krajina pôvodnej dane (ISO, napr. CZ) *</label><input name="taxCountry" required maxLength={2} placeholder="CZ" className={input} onChange={() => setReview(false)} /></div>
      <div><label className={label}>Mena daňového základu a dane (napr. CZK) *</label><input name="taxCurrency" required maxLength={3} defaultValue="EUR" className={input} onChange={() => setReview(false)} /></div>
      <div><label className={label}>Mena na úhradu (napr. EUR) *</label><input name="currency" required maxLength={3} defaultValue="EUR" className={input} onChange={() => setReview(false)} /></div>
      <div><label className={label}>Sadzba dane na origináli (%) *</label><input name="vatRate" required inputMode="decimal" placeholder="21" className={input} onChange={() => setReview(false)} /></div>
      <div><label className={label}>Pôvodný daňový základ *</label><input name="taxBase" required inputMode="decimal" placeholder="2 778,66" className={input} onChange={() => setReview(false)} /></div>
      <div><label className={label}>Pôvodná daň *</label><input name="taxAmount" required inputMode="decimal" placeholder="583,62" className={input} onChange={() => setReview(false)} /></div>
      <div><label className={label}>Pôvodný daňový súčet *</label><input name="taxTotal" required inputMode="decimal" placeholder="3 362,28" className={input} onChange={() => setReview(false)} /></div>
      <div><label className={label}>Suma na úhradu v jej mene *</label><input name="paymentGross" required inputMode="decimal" placeholder="137,46" className={input} onChange={() => setReview(false)} /></div>
      <div><label className={label}>Potvrdenie úhrady</label><select name="paymentConfirmation" defaultValue="" className={input} onChange={() => setReview(false)}><option value="">Neoverené / nezadané</option><option value="SUPPLIER_CONFIRMED">Dodávateľ potvrdil úhradu</option><option value="BANK_MATCHED">Spárované s bankou</option></select></div>
      <div><label className={label}>Dátum potvrdenej úhrady (ak je známy)</label><input name="externallyPaidAt" type="date" className={input} onChange={() => setReview(false)} /></div>
      <div className="sm:col-span-2"><label className={label}>Poznámka</label><textarea name="note" rows={3} className={input} onChange={() => setReview(false)} /></div>
    </div>
    {review && <section className="rounded-[10px] border border-amber-300 bg-amber-50 p-4 text-sm"><h2 className="font-semibold">Kontrola pred uložením</h2><p>{summary.direction} · {legalEntityLabels[summary.legalEntity] ?? "—"} · {summary.historicalKind === "PROFORMA" ? "predfaktúra" : "konečná faktúra"} · {summary.partnerName} · {summary.externalNumber}</p><p>Vystavená {summary.issueDate} · splatná {summary.dueDate} · VS {summary.variableSymbol || "—"}</p><p>Daň: {summary.taxBase} + {summary.taxAmount} = {summary.taxTotal} {summary.taxCurrency} · sadzba {summary.vatRate} % ({summary.taxCountry})</p><p>Na úhradu: {summary.paymentGross} {summary.currency} · úhrada: {summary.paymentConfirmation || "neoverená"}. Daňové posúdenie: neoverené; zahraničná DPH sa nepriradí k slovenskému odpočtu.</p><button type="button" className="mt-2 text-xs underline" onClick={() => setReview(false)}>Upraviť údaje</button></section>}
    {state.duplicateWarning && <p role="alert" className="rounded-[10px] bg-amber-50 p-3 text-sm text-amber-900">{state.duplicateWarning} Opätovným uložením potvrdíte kontrolu.</p>}
    {state.error && <p role="alert" className="rounded-[10px] bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
    <button type="submit" disabled={pending} className={btnPrimary}>{pending ? "Ukladám…" : review ? "Uložiť historický doklad" : "Skontrolovať doklad"}</button>
  </form>;
}
