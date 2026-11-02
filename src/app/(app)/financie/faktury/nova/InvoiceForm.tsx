"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { createManualInvoice, type InvoiceFormState } from "../../_actions";
import { formatCents } from "@/lib/format";
import { lineNetCents, parseUnitPrice, unitPriceCents } from "@/lib/precise-price";
import { btnPrimary, btnSmall, errorBox, input, label } from "@/components/ui";
import Link from "next/link";
import { legalEntityLabels } from "@/lib/zod-schemas";

interface ClientOption {
  id: string;
  name: string;
  type: string;
}

interface Line {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string; // EUR text, napr. "1,80"
  vatRate: string;
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

export function InvoiceForm({ clients }: { clients: ClientOption[] }) {
  const [state, formAction, pending] = useActionState<InvoiceFormState, FormData>(
    createManualInvoice,
    {},
  );
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);

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
            quantity,
            unit: line.unit,
            unitPriceCents: unitPriceCents(exact),
            unitPriceExact: exact,
            vatRate: Number.parseInt(line.vatRate, 10) || 0,
          };
        } catch {
          return null;
        }
      })
      .filter((item) => item && item.description && item.quantity > 0);
    return JSON.stringify(items);
  }, [lines]);
  const invalidPriceRows = lines.map((line) => {
    try { parseUnitPrice(line.unitPrice); return false; } catch { return true; }
  });

  const today = new Date().toISOString().slice(0, 10);
  const in14days = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  return (
    <form action={formAction} className="max-w-6xl space-y-5">
      <input type="hidden" name="items" value={itemsJson} />
      <div className="space-y-5">
      <div className="rounded-[14px] border border-stone-200 bg-white p-5">
        <div className="-mx-5 -mt-5 mb-5 rounded-t-[14px] bg-stone-100 px-5 py-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-stone-700">Všeobecné informácie</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div><label className={label}>Právny subjekt *</label><select name="legalEntity" required defaultValue="" className={input}><option value="" disabled>— vyberte subjekt —</option>{Object.entries(legalEntityLabels).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></div>
          <div>
            <label className={label}>Druh dokladu</label>
            <input type="hidden" name="direction" value="VYDANA" />
            <p className="rounded-[10px] border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">Vydaná faktúra</p>
          </div>
          <div><label className={label}>Číslo faktúry</label><p className="rounded-[10px] border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-500">Pridelí sa pri finalizácii</p></div>

          <div className="sm:col-span-2 lg:col-span-3">
              <label className={label}>Odberateľ</label>
              <select name="clientId" required className={input} defaultValue="">
                <option value="" disabled>
                  — vyberte klienta —
                </option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type})
                  </option>
                ))}
              </select>
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
            <input name="issueDate" type="date" defaultValue={today} required className={input} />
          </div>
          <div>
            <label className={label}>Dátum splatnosti</label>
            <input name="dueDate" type="date" defaultValue={in14days} required className={input} />
          </div>
          <div>
            <label className={label}>Dátum dodania</label>
            <input name="deliveryDate" type="date" defaultValue={today} required className={input} />
          </div>
          <div>
            <label className={label}>
              Variabilný symbol <span className="font-normal text-stone-400">(inak auto)</span>
            </label>
            <input name="variableSymbol" className={input} />
          </div>
          <div>
            <label className={label}>
              Externé číslo <span className="font-normal text-stone-400">(číslo od dodávateľa)</span>
            </label>
            <input name="externalNumber" className={input} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={label}>Poznámka</label>
            <textarea name="note" rows={4} className={input} placeholder="Text, ktorý sa má zobraziť pri doklade" />
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
                />
              </div>
              <div className="sm:col-span-2 xl:col-span-1">
                <label htmlFor={`item-unit-${index}`} className="mb-1 block text-xs text-stone-500">Jednotka</label>
                <select
                  id={`item-unit-${index}`}
                  value={line.unit}
                  onChange={(e) => updateLine(index, { unit: e.target.value })}
                  className={input}
                >
                  {["ks", "kg", "l", "g", "ml"].map((u) => (
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
                  value={line.vatRate}
                  onChange={(e) => updateLine(index, { vatRate: e.target.value })}
                  className={input}
                >
                  <option value="23">23 %</option>
                  <option value="19">19 %</option>
                  <option value="5">5 %</option>
                  <option value="0">0 %</option>
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
      <p className="text-xs text-stone-500">Uložením vznikne koncept. Faktúra sa tým ešte nefinalizuje ani neodošle.</p>
      <button type="submit" disabled={pending || invalidPriceRows.some(Boolean)} className={btnPrimary}>
        {pending ? "Ukladám…" : "Uložiť koncept"}
      </button>
      </div>
      </div>
    </form>
  );
}
