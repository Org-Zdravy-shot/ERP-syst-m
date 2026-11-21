"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { createManualInvoice, type InvoiceFormState } from "../../_actions";
import { formatCents } from "@/lib/format";
import { lineNetCents, parseUnitPrice, unitPriceCents } from "@/lib/precise-price";
import { btnPrimary, btnSmall, errorBox, input, label } from "@/components/ui";
import Link from "next/link";
import { legalEntityLabels } from "@/lib/zod-schemas";
import { InvoiceCustomerPicker } from "./InvoiceCustomerPicker";
import { FmcgFields, fmcgLabels } from "../fmcg-fields";
import { fmcgLineSchema } from "@/lib/finance/einvoice/fmcg";
import type { InvoiceFormInitial, InvoiceFormLine as Line } from "../invoice-form-data";
import { slovakDateKey } from "../../../objednavky/pricing";

interface ClientOption {
  id: string;
  name: string;
  type: string;
}

const EMPTY_LINE: Line = { description: "", quantity: "1", unit: "ks", vatRate: "0", unitPrice: "" };

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

export function InvoiceForm({ clients, initial, action = createManualInvoice, editing = false }: {
  clients: ClientOption[]; initial?: InvoiceFormInitial; editing?: boolean;
  action?: (state: InvoiceFormState, data: FormData) => Promise<InvoiceFormState>;
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
    legalEntity: initial?.legalEntity ?? "", issueDate: initial?.issueDate ?? today,
    dueDate: initial?.dueDate ?? in14days, deliveryDate: initial?.deliveryDate ?? today,
    variableSymbol: initial?.variableSymbol ?? "", externalNumber: initial?.externalNumber ?? "",
    buyerReference: initial?.buyerReference ?? "", note: initial?.note ?? "",
  }));

  const updateLine = (index: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const totals = useMemo(() => {
    let net = 0;
    let vat = 0;
    for (const line of lines) {
      const parsed = lineCents(line);
      if (!parsed) continue;
      net += parsed.netCents;
      vat += Math.round((parsed.netCents * parsed.vatRate) / 100);
    }
    return { net, vat, gross: net + vat };
  }, [lines]);

  const itemsJson = useMemo(() => {
    const items = lines
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
  }, [lines]);
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
    <form action={formAction} className="max-w-6xl space-y-5">
      <input type="hidden" name="items" value={itemsJson} />
      {editing && <input type="hidden" name="expectedUpdatedAt" value={initial?.expectedUpdatedAt ?? ""} />}
      <div className="space-y-5">
      <div className="rounded-[14px] border border-stone-200 bg-white p-5">
        <div className="-mx-5 -mt-5 mb-5 rounded-t-[14px] bg-stone-100 px-5 py-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-stone-700">Všeobecné informácie</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div><label className={label}>Právny subjekt *</label><select name="legalEntity" required value={header.legalEntity} onChange={(e) => setHeader({ ...header, legalEntity: e.target.value })} className={input}><option value="" disabled>— vyberte subjekt —</option>{Object.entries(legalEntityLabels).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></div>
          <div>
            <label className={label}>Druh dokladu</label>
            <input type="hidden" name="direction" value="VYDANA" />
            <p className="rounded-[10px] border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">Vydaná faktúra</p>
          </div>
          <div><label className={label}>Číslo faktúry</label><p className="rounded-[10px] border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-500">Pridelí sa pri finalizácii</p></div>

          <div className="sm:col-span-2 lg:col-span-3">
              <InvoiceCustomerPicker clients={clients} initialClientId={initial?.clientId} onSavingChange={setSavingClient} />
            </div>
          <p className="text-sm sm:col-span-2 lg:col-span-3"><Link href="/financie/faktury/historicka" className="font-medium text-stone-700 underline">Zaevidovať prijatú faktúru alebo predfaktúru →</Link></p>

          </div>
        </div>

      <div className="rounded-[14px] border border-stone-200 bg-white p-5">
        <div className="-mx-5 -mt-5 mb-5 rounded-t-[14px] bg-stone-100 px-5 py-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-stone-700">Dátumy a platba</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={label}>Dátum vystavenia</label>
            <input name="issueDate" type="date" value={header.issueDate} onChange={(e) => setHeader({ ...header, issueDate: e.target.value })} required className={input} />
          </div>
          <div>
            <label className={label}>Dátum splatnosti</label>
            <input name="dueDate" type="date" value={header.dueDate} onChange={(e) => setHeader({ ...header, dueDate: e.target.value })} required className={input} />
          </div>
          <div>
            <label className={label}>Dátum dodania</label>
            <input name="deliveryDate" type="date" value={header.deliveryDate} onChange={(e) => setHeader({ ...header, deliveryDate: e.target.value })} required className={input} />
          </div>
          <div>
            <label className={label}>
              Variabilný symbol <span className="font-normal text-stone-400">(inak auto)</span>
            </label>
            <input name="variableSymbol" value={header.variableSymbol} onChange={(e) => setHeader({ ...header, variableSymbol: e.target.value })} className={input} />
          </div>
          <div>
            <label className={label}>
              Externé číslo <span className="font-normal text-stone-400">(voliteľné)</span>
            </label>
            <input name="externalNumber" value={header.externalNumber} onChange={(e) => setHeader({ ...header, externalNumber: e.target.value })} className={input} />
          </div>
          <div>
            <label htmlFor="buyer-reference" className={label}>Referencia odberateľa</label>
            <input id="buyer-reference" name="buyerReference" maxLength={140} value={header.buyerReference} onChange={(e) => setHeader({ ...header, buyerReference: e.target.value })} className={input} placeholder="Údaj, ktorý vám poskytol odberateľ" />
            <p className="mt-1 text-xs text-stone-500">Potrebná pre elektronickú faktúru. Použite referenciu od odberateľa, napríklad číslo jeho objednávky.</p>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={label}>Poznámka</label>
            <textarea name="note" rows={4} value={header.note} onChange={(e) => setHeader({ ...header, note: e.target.value })} className={input} placeholder="Text, ktorý sa má zobraziť pri doklade" />
          </div>
        </div>
      </div>

      <div className="rounded-[14px] border border-stone-200 bg-white">
        <div className="rounded-t-[14px] bg-stone-100 px-5 py-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-stone-700">Položky faktúry</h2>
        </div>
        <p className="px-5 pt-3 text-xs text-stone-500">Cena je bez DPH a môže mať najviac 4 desatinné miesta.</p>
        <div className="space-y-3 p-5">
          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-2 gap-3 sm:grid-cols-6 xl:grid-cols-12">
              <div className="col-span-2 sm:col-span-6 xl:col-span-4">
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
                >
                  {[...new Set(["23", "19", "5", "0", line.vatRate])].map((rate) => <option key={rate} value={rate}>{rate} %</option>)}
                  {line.taxCategory === "EXEMPT" && <option value="EXEMPT">0 % — oslobodené</option>}
                </select>
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

      {state.error && <p className={errorBox}>{state.error}</p>}

      <div className="flex flex-wrap items-center justify-end gap-4">
      <p className="text-xs text-stone-500">{editing ? "Uložia sa zmeny konceptu. Faktúra sa tým nevystaví ani neodošle." : "Uložením vznikne koncept. Faktúra sa tým ešte nefinalizuje ani neodošle."}</p>
      <button type="submit" disabled={pending || savingClient || invalidPriceRows.some(Boolean) || invalidQuantityRows.some(Boolean) || fmcgErrors.some(Boolean)} className={btnPrimary}>
        {pending ? "Ukladám…" : editing ? "Uložiť zmeny konceptu" : "Uložiť koncept"}
      </button>
      </div>
      </div>
    </form>
  );
}
