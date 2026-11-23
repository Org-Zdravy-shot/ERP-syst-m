"use client";

import { useEffect, useId, useRef, useState } from "react";
import { searchCompanies } from "@/app/(app)/klienti/company-actions";
import type { CompanyMatch } from "@/lib/company-lookup";
import { CustomerVatStatus } from "./CustomerVatStatus";
import { input, label } from "./ui";

export function CompanySearch({ onSelect }: { onSelect: (company: CompanyMatch) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CompanyMatch[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setResults([]); setNotice(""); setActive(-1);
    if (query.trim().length < 3 || !open) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await searchCompanies(query);
        if (request !== generation.current) return;
        setResults(result.companies); setNotice(result.notice ?? (result.companies.length ? "" : "Nenašli sme zhodu. Skúste celé IČO alebo údaje zadajte ručne."));
      } catch {
        if (request === generation.current) setNotice("Vyhľadávanie sa nepodarilo. Skúste to znova alebo vyplňte údaje ručne.");
      } finally { if (request === generation.current) setLoading(false); }
    }, 650);
    return () => { clearTimeout(timer); generation.current++; };
  }, [query, open]);
  function choose(row: CompanyMatch) {
    generation.current++; setOpen(false); setQuery(row.name); setResults([]); setLoading(false); onSelect(row);
  }
  return <div className="relative rounded-xl border border-brand/60 bg-amber-50/40 p-4">
    <label htmlFor={id} className={label}>Vyhľadať firmu podľa názvu alebo IČO</label>
    <input id={id} role="combobox" aria-expanded={open && results.length > 0} aria-controls={`${id}-results`} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined} autoComplete="off" maxLength={100} value={query} className={input} placeholder="Začnite písať názov alebo celé IČO"
      onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { setOpen(false); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); setActive((v) => Math.min(v + 1, results.length - 1)); }
        if (e.key === "ArrowUp" && results.length) { e.preventDefault(); setActive((v) => Math.max(v - 1, 0)); }
        if (e.key === "Enter" && open) { e.preventDefault(); if (active >= 0 && results[active]) choose(results[active]); }
      }} />
    <div aria-live="polite" className="mt-2 text-xs text-stone-600">{loading ? "Hľadám firmy…" : notice || "Vyberte výsledok a dostupné fakturačné údaje sa doplnia."}</div>
    {open && results.length > 0 && <ul id={`${id}-results`} role="listbox" className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-sm">
      {results.map((row, index) => <li key={row.id} role="option" id={`${id}-${index}`} aria-selected={active === index}>
        <button type="button" onClick={() => choose(row)} className={`w-full border-b border-stone-100 px-3 py-3 text-left text-sm hover:bg-amber-50 ${active === index ? "bg-amber-100" : ""}`}>
          <span className="block font-semibold text-stone-950">{row.name}</span>
          <span className="block text-xs text-stone-600">IČO {row.ico || "—"} · {[row.street, row.city].filter(Boolean).join(", ")} · {({ ERP: "Uložený klient", AUTOFORM: "Autoform", RPO: "Verejný register RPO" })[row.source]}</span>
          {(row.dic || row.icDph) && <span className="block text-xs text-stone-600">{[row.dic && `DIČ ${row.dic}`, row.icDph && `IČ DPH ${row.icDph}`].filter(Boolean).join(" · ")}</span>}
          <CustomerVatStatus status={row.vatStatus} checkedOn={row.vatCheckedOn} />
        </button>
      </li>)}
    </ul>}
    {results.some((row) => row.source === "RPO") && (
      <p className="mt-2 text-xs text-stone-500">
        Zdroj: <a href="https://rpo.minv.sk/new/" target="_blank" rel="noreferrer" className="underline">RPO, Ministerstvo vnútra SR</a>
        {" · "}<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className="underline">CC BY 4.0</a>.
        {" ERP vyberá aktuálny záznam a formátuje adresu."}
      </p>
    )}
    {results.some((row) => row.source === "AUTOFORM") && <p className="mt-2 text-xs text-stone-500">Údaje: <a href="https://ekosystem.slovensko.digital/sluzby/autoform" target="_blank" rel="noreferrer" className="underline">Slovensko.Digital – Autoform</a>. Pred uložením skontrolujte ich aktuálnosť.</p>}
    {results.some((row) => row.vatStatus) && <p className="mt-2 text-xs text-stone-500">Daňové údaje z <a href="https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy/exporty-z-online-informacnych" target="_blank" rel="noreferrer" className="underline">informačných zoznamov Finančnej správy</a>.</p>}
  </div>;
}
