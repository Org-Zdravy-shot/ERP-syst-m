import { input, label } from "@/components/ui";
import { fmcgLineSchema, type FmcgLineMetadata } from "@/lib/finance/einvoice/fmcg";

type Property = keyof FmcgLineMetadata["properties"];
export const fmcgLabels: Record<Property | "gtin", string> = {
  gtin: "EAN / GTIN produktu", item_type: "Typ položky", units_per_carton: "Kusov v kartóne",
  delivery_date: "Dátum dodania položky", buyer_order_number: "Objednávka odberateľa", buyer_order_date: "Dátum objednávky odberateľa",
  supplier_order_number: "Objednávka dodávateľa", supplier_order_date: "Dátum objednávky dodávateľa",
  delivery_note_number: "Číslo dodacieho listu", delivery_note_date: "Dátum dodacieho listu",
  receiving_advice_number: "Číslo príjemky (RECADV)", receiving_advice_date: "Dátum príjemky",
  ordered_by_gln: "GLN objednávateľa", delivery_party_gln: "GLN miesta dodania", store_number_gln: "GLN predajne",
  ultimate_customer_gln: "GLN konečného miesta dodania", ultimate_customer_name: "Konečný odberateľ",
  batch_number: "Šarža", expiry_date: "Dátum exspirácie", consumer_unit_price: "Spotrebiteľská cena za jednotku",
  excise_duty_category_code: "Kód spotrebnej dane", excise_duty_basis: "Základ spotrebnej dane", excise_duty_amount: "Suma spotrebnej dane",
  recycling_fee_type: "Typ recyklačného poplatku", recycling_fee_amount: "Recyklačný poplatok spolu",
  recycling_fee_per_unit: "Recyklačný poplatok za jednotku", recycling_fee_unit: "Jednotka recyklačného poplatku",
  copyright_fee_type: "Typ autorského poplatku", copyright_fee_amount: "Autorský poplatok spolu",
  copyright_fee_per_unit: "Autorský poplatok za jednotku", copyright_fee_unit: "Jednotka autorského poplatku",
  invoice_reference_type: "Typ súvisiacej faktúry", invoice_reference_number: "Číslo súvisiacej faktúry", invoice_reference_date: "Dátum súvisiacej faktúry",
  free_reference: "Ďalšia referencia", free_reference_date: "Dátum referencie", free_text_law: "Zákonný text", sukl_id: "Kód ŠÚKL", vat_amount: "DPH položky (kontrolná suma)",
};
const basic: Property[] = ["buyer_order_number", "delivery_note_number", "receiving_advice_number", "batch_number", "expiry_date", "delivery_date"];
const decimals = new Set<Property>(["units_per_carton", "consumer_unit_price", "excise_duty_basis", "excise_duty_amount", "recycling_fee_amount", "recycling_fee_per_unit", "copyright_fee_amount", "copyright_fee_per_unit", "vat_amount"]);

export function FmcgFields({ value, onChange, row }: { value?: FmcgLineMetadata; onChange: (value: FmcgLineMetadata | undefined) => void; row: number }) {
  function update(key: Property | "gtin", raw: string) {
    const next: FmcgLineMetadata = { ...value, properties: { ...value?.properties } };
    const text = decimals.has(key as Property) ? raw.replace(",", ".") : raw;
    if (key === "gtin") { if (text) next.gtin = text; else delete next.gtin; }
    else { if (text) Object.assign(next.properties, { [key]: text }); else delete next.properties[key]; }
    onChange(next.gtin || Object.keys(next.properties).length ? next : undefined);
  }
  function field(key: Property | "gtin") {
    const id = `fmcg-${row}-${key}`;
    const current = key === "gtin" ? value?.gtin ?? "" : value?.properties[key] ?? "";
    return <div key={key}>
      <label htmlFor={id} className={label}>{fmcgLabels[key]}</label>
      {key === "item_type" || key === "invoice_reference_type" ? <select id={id} className={input} value={current} onChange={(e) => update(key, e.target.value)}>
        <option value="">Nevyplnené</option>
        {(key === "item_type" ? [["Z", "Tovar"], ["O", "Obal"], ["S", "Služba"]] : [["IV", "Faktúra"], ["AAB", "Predfaktúra"]]).map(([code, title]) => <option key={code} value={code}>{title}</option>)}
      </select> : <input id={id} className={input} type={key.endsWith("_date") ? "date" : "text"} inputMode={decimals.has(key as Property) ? "decimal" : undefined} maxLength={512} value={current} onChange={(e) => update(key, e.target.value)} />}
    </div>;
  }
  return <details className="rounded-xl border border-stone-200 bg-stone-50 p-3">
    <summary className="cursor-pointer text-sm font-medium text-stone-800">Údaje pre obchodné reťazce{value ? " · vyplnené" : " · voliteľné"}</summary>
    <p className="mb-3 mt-2 text-xs text-stone-600">Doplňte údaje požadované odberateľom pre túto položku. Poplatky tu slúžia ako informácia; nemenia cenu položky.</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{field("gtin")}{field("item_type")}{basic.map(field)}</div>
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-medium text-stone-700">Ďalšie dátumy, miesta dodania a poplatky</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{(Object.keys(fmcgLabels) as Array<Property | "gtin">).filter((key) => key !== "gtin" && key !== "item_type" && !basic.includes(key)).map(field)}</div>
    </details>
  </details>;
}

export function FmcgSummary({ snapshot }: { snapshot: unknown }) {
  if (snapshot == null) return null;
  const parsed = fmcgLineSchema.safeParse(snapshot);
  if (!parsed.success) return <p className="mt-1 text-xs text-red-700">Uložené údaje pre reťazec nie sú platné. Pred vystavením ich skontrolujte.</p>;
  const entries = [...(parsed.data.gtin ? [["gtin", parsed.data.gtin]] : []), ...Object.entries(parsed.data.properties)];
  return <details className="mt-2 text-xs font-normal text-stone-600">
    <summary className="cursor-pointer">Údaje pre obchodný reťazec ({entries.length})</summary>
    <dl className="mt-2 space-y-1">{entries.map(([key, value]) => <div key={key}><dt className="inline font-medium">{fmcgLabels[key as Property | "gtin"]}: </dt><dd className="inline break-words">{value}</dd></div>)}</dl>
  </details>;
}
