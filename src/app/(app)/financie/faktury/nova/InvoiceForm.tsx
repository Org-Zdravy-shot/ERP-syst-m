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

export function InvoiceForm({ clients }: { clients: ClientOption[] }) {
  const [state, formAction, pending] = useActionState<InvoiceFormState, FormData>(
    createManualInvoice,
    {},
  );
  const [direction, setDirection] = useState<"VYDANA" | "PRIJATA">("VYDANA");
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
    <form action={formAction} className="grid max-w-6xl items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <input type="hidden" name="items" value={itemsJson} />
      <div className="space-y-5">
      <div className="rounded-[14px] border border-stone-200 bg-white p-5">
        <div className="mb-5 flex items-start gap-3 border-b border-stone-100 pb-4">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-950 text-xs font-bold text-white">1</span>
          <div><h2 className="font-semibold text-stone-950">Komu fakturujete</h2><p className="mt-0.5 text-sm text-stone-500">Vyberte subjekt a odberateľa dokladu.</p></div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className={label}>Právny subjekt *</label><select name="legalEntity" required defaultValue="" className={input}><option value="" disabled>— vyberte subjekt —</option>{Object.entries(legalEntityLabels).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></div>
          <div>
            <label className={label}>Smer faktúry</label>
            <select
              name="direction"
              value={direction}
              onChange={(e) => setDirection(e.target.value as "VYDANA" | "PRIJATA")}
              className={input}
            >
              <option value="VYDANA">Vydaná (+) — odberateľovi</option>
              <option value="PRIJATA" disabled>Prijatá — použite evidenciu historického originálu</option>
            </select>
          </div>
          <p className="self-end text-sm sm:col-span-2"><Link href="/financie/faktury/historicka" className="underline">Zaevidovať prijatú faktúru alebo predfaktúru →</Link></p>

          {direction === "VYDANA" ? (
          <div className="sm:col-span-2">
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
          ) : (
          <div className="sm:col-span-2">
              <label className={label}>Dodávateľ</label>
              <input
                name="supplierName"
                required
                placeholder="napr. Bio Farma Šariš s.r.o."
                className={input}
              />
            </div>
          )}

          </div>
        </div>

      <div className="rounded-[14px] border border-stone-200 bg-white p-5">
        <div className="mb-5 flex items-start gap-3 border-b border-stone-100 pb-4">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-950 text-xs font-bold text-white">2</span>
          <div><h2 className="font-semibold text-stone-950">Dátumy a platba</h2><p className="mt-0.5 text-sm text-stone-500">Údaje sa uložia do konceptu faktúry.</p></div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          <div className="sm:col-span-2">
            <label className={label}>Poznámka</label>
            <input name="note" className={input} />
          </div>
        </div>
      </div>

      <div className="rounded-[14px] border border-stone-200 bg-white">
        <div className="flex items-start gap-3 border-b border-stone-100 px-5 py-4">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-950 text-xs font-bold text-white">3</span>
          <div><h2 className="font-semibold text-stone-950">Položky faktúry</h2><p className="mt-0.5 text-sm text-stone-500">Cena je bez DPH a môže mať najviac 4 desatinné miesta.</p></div>
        </div>
        <div className="space-y-3 p-5">
          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              <div className="col-span-2 sm:col-span-6">
                <label htmlFor={`item-description-${index}`} className="mb-1 block text-xs text-stone-500">Popis</label>
                <input
                  id={`item-description-${index}`}
                  placeholder="Popis položky"
                  value={line.description}
                  onChange={(e) => updateLine(index, { description: e.target.value })}
                  className={input}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor={`item-quantity-${index}`} className="mb-1 block text-xs text-stone-500">Množstvo</label>
                <input
                  id={`item-quantity-${index}`}
                  placeholder="Množstvo"
                  value={line.quantity}
                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                  className={input}
                />
              </div>
              <div className="sm:col-span-2">
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
              <div className="sm:col-span-3">
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
              <div className="sm:col-span-2">
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
              <div className="flex items-end sm:col-span-1">
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

        <div className="border-t border-stone-200 px-5 py-3 text-right text-sm lg:hidden">
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

      <button type="submit" disabled={pending || invalidPriceRows.some(Boolean)} className={`${btnPrimary} w-full lg:hidden`}>
        {pending ? "Ukladám…" : "Uložiť koncept"}
      </button>
      </div>

      <aside className="hidden rounded-[14px] border border-stone-200 bg-white p-5 lg:sticky lg:top-6 lg:block">
        <h2 className="font-semibold text-stone-950">Súhrn konceptu</h2>
        <p className="mt-1 text-sm text-stone-500">Priebežný výpočet podľa zadaných položiek.</p>
        <dl className="mt-5 space-y-3 border-b border-stone-200 pb-4 text-sm">
          <div className="flex justify-between gap-2"><dt className="text-stone-500">Základ</dt><dd className="font-medium tabular-nums">{formatCents(totals.net)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-stone-500">DPH</dt><dd className="font-medium tabular-nums">{formatCents(totals.vat)}</dd></div>
        </dl>
        <div className="mt-4 flex items-center justify-between gap-2"><span className="font-semibold">Spolu</span><strong className="font-display text-xl tabular-nums">{formatCents(totals.gross)}</strong></div>
        <button type="submit" disabled={pending || invalidPriceRows.some(Boolean)} className={`${btnPrimary} mt-5 w-full`}>{pending ? "Ukladám…" : "Uložiť koncept"}</button>
        <p className="mt-3 text-xs text-stone-500">Uložením vznikne koncept. Faktúra sa tým ešte nefinalizuje ani neodošle.</p>
      </aside>
    </form>
  );
}
