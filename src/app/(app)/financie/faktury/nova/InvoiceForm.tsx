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
    <form action={formAction} className="max-w-4xl space-y-5">
      <input type="hidden" name="items" value={itemsJson} />

      <div className="rounded-[14px] border border-stone-200 bg-white p-5">
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
            <div>
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
            <div>
              <label className={label}>Dodávateľ</label>
              <input
                name="supplierName"
                required
                placeholder="napr. Bio Farma Šariš s.r.o."
                className={input}
              />
            </div>
          )}

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
        <div className="border-b border-stone-100 px-5 py-3 text-[13.5px] font-semibold text-stone-950">
          Položky
        </div>
        <div className="space-y-3 p-5">
          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-2 gap-3 sm:grid-cols-12">
              <div className="col-span-2 sm:col-span-5">
                <input
                  placeholder="Popis položky"
                  value={line.description}
                  onChange={(e) => updateLine(index, { description: e.target.value })}
                  className={input}
                />
              </div>
              <div className="sm:col-span-2">
                <input
                  placeholder="Množstvo"
                  value={line.quantity}
                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                  className={input}
                />
              </div>
              <div className="sm:col-span-1">
                <select
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
              <div className="sm:col-span-2">
                <input
                  placeholder="Cena/j. € bez DPH"
                  value={line.unitPrice}
                  onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                  className={input}
                  aria-invalid={invalidPriceRows[index]}
                  aria-describedby={invalidPriceRows[index] ? `invoice-price-error-${index}` : undefined}
                />
                {invalidPriceRows[index] && <p id={`invoice-price-error-${index}`} className="mt-1 text-xs text-red-700">Zadajte cenu s najviac 4 desatinnými miestami (čiarka alebo bodka).</p>}
              </div>
              <div className="sm:col-span-1">
                <select
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
              <div className="flex items-center sm:col-span-1">
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

        <div className="border-t border-stone-200 px-5 py-3 text-right text-sm">
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

      <button type="submit" disabled={pending || invalidPriceRows.some(Boolean)} className={btnPrimary}>
        {pending ? "Ukladám…" : "Uložiť koncept"}
      </button>
    </form>
  );
}
