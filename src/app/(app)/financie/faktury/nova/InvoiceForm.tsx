"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { createManualInvoice, type InvoiceFormState } from "../../_actions";
import { formatCents } from "@/lib/format";
import { lineNetCents, parseUnitPrice, unitPriceCents } from "@/lib/precise-price";
import { btnPrimary, btnSmall, errorBox, input, label } from "@/components/ui";
import Link from "next/link";
import { legalEntityLabels } from "@/lib/zod-schemas";
import { InvoiceCustomerPicker, type ClientOption } from "./InvoiceCustomerPicker";
import type { InvoiceProductOption, IssuerOption } from "../form-options";
import { FmcgFields, fmcgLabels } from "../fmcg-fields";
import { fmcgLineSchema } from "@/lib/finance/einvoice/fmcg";
import type { InvoiceFormInitial, InvoiceFormLine as Line } from "../invoice-form-data";
import { slovakDateKey } from "../../../objednavky/pricing";

const EMPTY_LINE: Line = { description: "", quantity: "1", unit: "ks", vatRate: "", unitPrice: "" };

function parseQty(value: string): number {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineCents(line: Line): { netCents: number; vatRate: number } | null {
  try {
    const quantity = parseQty(line.quantity);
    if (quantity <= 0) return null;
    const netCents = lineNetCents(quantity, parseUnitPrice(line.unitPrice));
    return { netCents, vatRate: Number.parseInt(line.vatRate, 10) || 0 };
  } catch {
    return null;
  }
}

function lineGrossCents(line: Line): number | null {
  const parsed = lineCents(line);
  return parsed ? parsed.netCents + Math.round((parsed.netCents * parsed.vatRate) / 100) : null;
}

export function InvoiceForm({ clients, issuers = [], catalog = [], canConfigure = false, initial, defaultIssuer, backHref = "/financie/faktury", action = createManualInvoice, editing = false }: {
  clients: ClientOption[]; issuers?: IssuerOption[]; catalog?: InvoiceProductOption[]; canConfigure?: boolean; initial?: InvoiceFormInitial; defaultIssuer?: string; editing?: boolean;
  action?: (state: InvoiceFormState, data: FormData) => Promise<InvoiceFormState>;
  backHref?: string;
}) {
  const today = slovakDateKey();
  const in14days = new Date(new Date(`${today}T12:00:00.000Z`).getTime() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [state, formAction, pending] = useActionState<InvoiceFormState, FormData>(
    action,
    {},
  );
  const [lines, setLines] = useState<Line[]>(initial?.lines.length ? initial.lines : [{ ...EMPTY_LINE }]);
  const [savingClient, setSavingClient] = useState(false);
  const [header, setHeader] = useState(() => ({
    legalEntity: initial?.legalEntity ?? defaultIssuer ?? "", issueDate: initial?.issueDate ?? today,
    dueDate: initial?.dueDate ?? in14days, deliveryDate: initial?.deliveryDate ?? today,
    variableSymbol: initial?.variableSymbol ?? "", externalNumber: initial?.externalNumber ?? "",
    buyerReference: initial?.buyerReference ?? "", note: initial?.note ?? "",
  }));

  const updateLine = (index: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const taxDate = header.deliveryDate || header.issueDate;
  const validOn = (row: { validFrom: string; validTo: string | null }) => row.validFrom <= taxDate && (!row.validTo || row.validTo >= taxDate);
  const issuer = issuers.find(profile => profile.legalEntity === header.legalEntity && validOn(profile));
  const taxProfile = issuer?.taxProfiles.find(validOn);
  const payer = taxProfile?.vatStatus === "PAYER" && !!taxProfile.vatRegisteredFrom && taxProfile.vatRegisteredFrom <= taxDate;
  const nonPayer = taxProfile?.vatStatus === "NON_PAYER" || (
    taxProfile?.vatStatus === "PAYER" && !!taxProfile.vatRegisteredFrom && taxProfile.vatRegisteredFrom > taxDate
  );
  const activeRates = lines.map(line => catalog.find(product => product.id === line.productId)?.vatRates.find(validOn));
  const taxableLines = lines.map((line, index): Line => {
    if (nonPayer) return { ...line, vatRate: "0", taxCategory: "STANDARD" };
    if (payer && line.taxCategory !== "EXEMPT" && activeRates[index]?.confirmed) {
      return { ...line, vatRate: String(activeRates[index].rate) };
    }
    return { ...line, vatRate: line.vatRate || (payer ? "23" : "0") };
  });

  const totals = useMemo(() => {
    let net = 0;
    let vat = 0;
    for (const line of taxableLines) {
      const parsed = lineCents(line);
      if (!parsed) continue;
      net += parsed.netCents;
      vat += Math.round((parsed.netCents * parsed.vatRate) / 100);
    }
    return { net, vat, gross: net + vat };
  }, [taxableLines]);

  const itemsJson = useMemo(() => {
    const items = taxableLines
      .map((line) => {
        try {
          const quantity = parseQty(line.quantity);
          const exact = parseUnitPrice(line.unitPrice);
          if (quantity <= 0) return null;
          return {
            description: line.description.trim(),
            productId: line.productId,
            productSku: line.productSku,
            quantity,
            unit: line.unit,
            unitPriceCents: unitPriceCents(exact),
            unitPriceExact: exact,
            vatRate: Number.parseInt(line.vatRate, 10) || 0,
            taxCategory: line.taxCategory,
            ...(line.fmcg ? { fmcg: line.fmcg } : {}),
          };
        } catch {
          return null;
        }
      });
    return JSON.stringify(items);
  }, [taxableLines]);
  const invalidPriceRows = lines.map((line) => {
    try { parseUnitPrice(line.unitPrice); return false; } catch { return true; }
  });
  const invalidQuantityRows = lines.map((line) => parseQty(line.quantity) <= 0);
  const fmcgErrors = lines.map((line) => {
    if (!line.fmcg) return "";
    const result = fmcgLineSchema.safeParse(line.fmcg);
    if (result.success) return "";
    const issue = result.error.issues[0];
    const key = String(issue.path.at(-1)) as keyof typeof fmcgLabels;
    return `${fmcgLabels[key] ?? "Údaje pre reťazec"}: ${issue.message}`;
  });

  return (
    <form action={formAction} className="finance-invoice-editor">
      <input type="hidden" name="items" value={itemsJson} />
      <input type="hidden" name="direction" value="VYDANA" />
      {editing && <input type="hidden" name="expectedUpdatedAt" value={initial?.expectedUpdatedAt ?? ""} />}
      <div className="finance-document">
        <div className="finance-document-title"><h2>Faktúra</h2><span>Koncept · číslo sa pridelí pri vystavení</span></div>
        <div className="finance-parties">
          <section><h3>Dodávateľ</h3><label className={label} htmlFor="invoice-issuer">Vaša firma *</label><select id="invoice-issuer" name="legalEntity" required value={header.legalEntity} onChange={e => setHeader({ ...header, legalEntity: e.target.value })} className={input}><option value="" disabled>Vyberte právny subjekt</option>{Object.entries(legalEntityLabels).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select>
            <div className="finance-issuer-address">{issuer ? <><strong>{issuer.legalName}</strong><p>{issuer.street}</p><p>{issuer.zip} {issuer.city}</p><p>IČO: {issuer.ico}</p><p>DIČ: {issuer.dic}</p>{payer && issuer.icDph && <p>IČ DPH: {issuer.icDph}</p>}<p>{payer ? "Platiteľ DPH" : nonPayer ? "Neplatiteľ DPH" : "Daňový profil chýba"}</p><p>{issuer.eurAccount ? "Platba na primárny EUR účet" : "Chýba primárny EUR účet"}</p></> : <p>{header.legalEntity ? "Pre dátum dodania chýba platný firemný profil." : "Po výbere firmy sa zobrazia vaše fakturačné údaje."}</p>}{canConfigure && <Link href="/financie/nastavenia">Firemné údaje a bankové účty</Link>}</div>
          </section>
          <section><h3>Odberateľ</h3><InvoiceCustomerPicker clients={clients} initialClientId={initial?.clientId} onSavingChange={setSavingClient} /></section>
        </div>
        <div className="finance-editor-section"><h3>Dátumy dokladu</h3><div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{([['issueDate','Vystavenie'],['deliveryDate','Dodanie'],['dueDate','Splatnosť']] as const).map(([key,title]) => <label className={label} key={key}>{title}<input name={key} type="date" value={header[key]} onChange={e => setHeader({ ...header, [key]: e.target.value })} required className={input} /></label>)}</div></div>
      <div className="finance-editor-section">
        <div className="mb-3 border-b border-stone-200 pb-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-stone-700">Položky faktúry</h2>
        </div>
        <p className="mb-4 text-xs text-stone-500">Cena je bez DPH a môže mať najviac 4 desatinné miesta.</p>
        <div className="space-y-3">
          {taxableLines.map((line, index) => (
            <div key={index} className="finance-invoice-row grid grid-cols-2 gap-3 sm:grid-cols-6 xl:grid-cols-12">
              <div className="col-span-2 sm:col-span-6 xl:col-span-4">
                {catalog.length > 0 && <label className="mb-2 block text-xs text-stone-500">
                  Produkt
                  <select className={input} value={line.productId ?? ""} onChange={(event) => {
                    const product = catalog.find(item => item.id === event.target.value);
                    updateLine(index, product ? {
                      productId: product.id, productSku: product.sku, description: product.name, unit: product.unit,
                      unitPrice: "", vatRate: "", taxCategory: "STANDARD", fmcg: undefined,
                    } : { productId: undefined, productSku: undefined, vatRate: "" });
                  }}>
                    <option value="">Ručne zadaná položka</option>
                    {line.productId && !catalog.some(item => item.id === line.productId) && <option value={line.productId}>Pôvodný produkt ({line.productSku ?? line.description})</option>}
                    {catalog.map(product => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
                  </select>
                </label>}
                <label htmlFor={`item-description-${index}`} className="mb-1 block text-xs text-stone-500">Popis</label>
                <input
                  id={`item-description-${index}`}
                  placeholder="Popis položky"
                  value={line.description}
                  onChange={(e) => updateLine(index, { description: e.target.value })}
                  className={input}
                />
              </div>
              <div className="sm:col-span-2 xl:col-span-1">
                <label htmlFor={`item-quantity-${index}`} className="mb-1 block text-xs text-stone-500">Množstvo</label>
                <input
                  id={`item-quantity-${index}`}
                  placeholder="Množstvo"
                  value={line.quantity}
                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                  className={input}
                  aria-invalid={invalidQuantityRows[index]}
                />
                {invalidQuantityRows[index] && <p className="mt-1 text-xs text-red-700">Zadajte kladné množstvo s najviac 6 desatinnými miestami.</p>}
              </div>
              <div className="sm:col-span-2 xl:col-span-1">
                <label htmlFor={`item-unit-${index}`} className="mb-1 block text-xs text-stone-500">Jednotka</label>
                <select
                  id={`item-unit-${index}`}
                  value={line.unit}
                  onChange={(e) => updateLine(index, { unit: e.target.value })}
                  className={input}
                >
                  {[...new Set(["ks", "kg", "l", "g", "ml", "hod", ...(line.unit ? [line.unit] : [])])].map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3 xl:col-span-2">
                <label htmlFor={`item-price-${index}`} className="mb-1 block text-xs text-stone-500">Cena/j.</label>
                <input
                  id={`item-price-${index}`}
                  placeholder="Cena/j. € bez DPH"
                  value={line.unitPrice}
                  onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                  className={input}
                  aria-invalid={invalidPriceRows[index]}
                  aria-describedby={invalidPriceRows[index] ? `invoice-price-error-${index}` : undefined}
                />
                {invalidPriceRows[index] && <p id={`invoice-price-error-${index}`} className="mt-1 text-xs text-red-700">Zadajte cenu s najviac 4 desatinnými miestami (čiarka alebo bodka).</p>}
              </div>
              <div className="sm:col-span-2 xl:col-span-1">
                <label htmlFor={`item-vat-${index}`} className="mb-1 block text-xs text-stone-500">DPH</label>
                <select
                  id={`item-vat-${index}`}
                  value={line.taxCategory === "EXEMPT" ? "EXEMPT" : line.vatRate}
                  onChange={(e) => updateLine(index, { vatRate: e.target.value === "EXEMPT" ? "0" : e.target.value, taxCategory: e.target.value === "EXEMPT" ? "EXEMPT" : "STANDARD" })}
                  className={input}
                  disabled={nonPayer || (payer && !!line.productId && line.taxCategory !== "EXEMPT")}
                >
                  {[...new Set(["23", "19", "5", "0", line.vatRate])].map((rate) => <option key={rate} value={rate}>{rate} %</option>)}
                  {line.taxCategory === "EXEMPT" && <option value="EXEMPT">0 % — oslobodené</option>}
                </select>
                {payer && line.productId && line.taxCategory !== "EXEMPT" && !activeRates[index]?.confirmed && (
                  <p className="mt-1 text-xs text-amber-800">Pre dátum dodania chýba potvrdená sadzba produktu.</p>
                )}
              </div>
              <div className="sm:col-span-2 xl:col-span-2">
                <p className="mb-1 text-xs text-stone-500">Celkom</p>
                <p className="rounded-[10px] border border-stone-200 bg-stone-50 px-3 py-2 text-right text-sm font-semibold tabular-nums text-stone-900">{lineGrossCents(line) === null ? "—" : formatCents(lineGrossCents(line) ?? 0)}</p>
              </div>
              <div className="flex items-end sm:col-span-1 xl:col-span-1">
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Odstrániť
                  </button>
                )}
              </div>
              <div className="col-span-2 sm:col-span-6 xl:col-span-12">
                <FmcgFields row={index + 1} value={line.fmcg} onChange={(fmcg) => updateLine(index, { fmcg })} />
                {fmcgErrors[index] && <p role="alert" className="mt-1 text-xs text-red-700">Riadok {index + 1}: {fmcgErrors[index]}</p>}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}
            className={btnSmall}
          >
            + Pridať položku
          </button>
        </div>

        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4 text-right text-sm">
          <span className="mr-6 text-stone-500">
            Základ: <span className="font-medium text-stone-900">{formatCents(totals.net)}</span>
          </span>
          <span className="mr-6 text-stone-500">
            DPH: <span className="font-medium text-stone-900">{formatCents(totals.vat)}</span>
          </span>
          <span className="text-stone-500">
            Spolu: <span className="font-bold text-stone-950">{formatCents(totals.gross)}</span>
          </span>
        </div>
      </div>

      <div className="finance-editor-section"><h3>Platba a doplňujúce údaje</h3><div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>Variabilný symbol<input name="variableSymbol" value={header.variableSymbol} onChange={e => setHeader({ ...header, variableSymbol: e.target.value })} placeholder="Vyplní sa automaticky" className={input} /></label>
        <label className={label}>Referencia odberateľa<input name="buyerReference" maxLength={140} value={header.buyerReference} onChange={e => setHeader({ ...header, buyerReference: e.target.value })} placeholder="Napríklad číslo objednávky odberateľa" className={input} /></label>
        <label className={label}>Externé číslo<input name="externalNumber" value={header.externalNumber} onChange={e => setHeader({ ...header, externalNumber: e.target.value })} className={input} /></label>
        <div className="text-xs text-stone-500">Referencia odberateľa je potrebná pre elektronickú faktúru. Použite údaj, ktorý vám poskytol odberateľ.</div>
      </div><label className={`${label} mt-4`}>Poznámka na doklade<textarea name="note" rows={3} value={header.note} onChange={e => setHeader({ ...header, note: e.target.value })} className={input} placeholder="Text pre odberateľa" /></label></div>
      </div>
      <aside className="finance-editor-sidebar"><h3>Súhrn konceptu</h3><dl><div><dt>Mena</dt><dd>EUR</dd></div><div><dt>Položky</dt><dd>{lines.length}</dd></div><div><dt>Základ dane</dt><dd>{formatCents(totals.net)}</dd></div><div><dt>DPH</dt><dd>{formatCents(totals.vat)}</dd></div><div className="finance-editor-grand"><dt>Celkom</dt><dd>{formatCents(totals.gross)}</dd></div></dl>
        {state.error && <div role="alert" className={`${errorBox} mb-3`}>{state.error}</div>}
        <button type="submit" disabled={pending || savingClient || invalidPriceRows.some(Boolean) || invalidQuantityRows.some(Boolean) || fmcgErrors.some(Boolean)} className={btnPrimary}>{pending ? "Ukladám…" : editing ? "Uložiť zmeny konceptu" : "Uložiť koncept"}</button>
        <p>Po uložení môžete faktúru skontrolovať a vystaviť. Číslo sa pridelí pri vystavení.</p><Link href={backHref}>Zrušiť úpravy</Link>
      </aside>
    </form>
  );
}
