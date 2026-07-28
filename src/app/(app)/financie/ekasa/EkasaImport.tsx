"use client";

import { useState } from "react";
import { useActionState } from "react";
import { importEkasaRows, type InvoiceFormState } from "../_actions";
import { formatCents } from "@/lib/format";
import { btnPrimary, errorBox, label } from "@/components/ui";
import { findColumn, parseAmountToCents, parseCsv, parseSkDate } from "../import/csv";
import { parseVrp2Xlsx, type Vrp2PreviewRow } from "@/lib/finance/import/vrp2-xlsx";

interface PreviewRow {
  saleDate: string;
  receiptNumber?: string;
  description?: string;
  productCode?: string;
  ean?: string;
  itemType?: string;
  quantity: number;
  totalGrossCents: number;
  vatRate: number | null;
  source: "VRP2_XLSX" | "CSV";
}

export function EkasaImport() {
  const [state, formAction, pending] = useActionState<InvoiceFormState, FormData>(importEkasaRows, {});
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [importBatch, setImportBatch] = useState("");
  const [receiptCount, setReceiptCount] = useState(0);
  const [ignoredRows, setIgnoredRows] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    setPreview([]);
    setReceiptCount(0);
    setIgnoredRows(0);
    setParseError(null);
    if (!file) return;

    setImportBatch(`${file.name} · ${new Date().toISOString()}`);
    if (file.name.toLowerCase().endsWith(".xlsx")) {
      try {
        const result = parseVrp2Xlsx(new Uint8Array(await file.arrayBuffer()));
        setPreview(result.rows satisfies Vrp2PreviewRow[]);
        setReceiptCount(result.receiptCount);
        setIgnoredRows(result.ignoredRows);
      } catch (error) {
        setParseError(error instanceof Error ? error.message : "Excel sa nepodarilo prečítať.");
      }
      return;
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setParseError("Podporovaný je rozšírený report VRP2 vo formáte XLSX alebo všeobecný CSV.");
      return;
    }

    const text = await file.text();
    const { headers, rows } = parseCsv(text);
    if (rows.length === 0) {
      setParseError("Súbor neobsahuje žiadne riadky.");
      return;
    }

    const col = {
      date: findColumn(headers, ["datum", "date"]),
      receipt: findColumn(headers, ["doklad", "paragon", "poradove", "cislo"]),
      description: findColumn(headers, ["popis", "nazov", "polozka", "produkt"]),
      productCode: findColumn(headers, ["kod tovaru", "sku"]),
      ean: findColumn(headers, ["ean"]),
      itemType: findColumn(headers, ["typ polozky"]),
      quantity: findColumn(headers, ["mnozstvo", "pocet", "ks"]),
      gross: findColumn(headers, ["s dph", "suma", "cena", "spolu", "celkom"]),
      vat: findColumn(headers, ["sadzba", "dph %"]),
    };

    if (col.date < 0 || col.gross < 0) {
      setParseError(
        `V CSV chýbajú povinné stĺpce (dátum, suma). Nájdené hlavičky: ${headers.join(", ")}`,
      );
      return;
    }

    const parsed: PreviewRow[] = [];
    for (const row of rows) {
      const saleDate = parseSkDate(row[col.date] ?? "");
      const totalGrossCents = parseAmountToCents(row[col.gross] ?? "");
      if (!saleDate || totalGrossCents === null) continue;

      const qtyRaw = col.quantity >= 0 ? row[col.quantity]?.replace(",", ".") : "1";
      const quantity = Number.parseFloat(qtyRaw || "1") || 1;
      const vatRaw = col.vat >= 0 ? Number.parseInt(row[col.vat] ?? "", 10) : NaN;

      parsed.push({
        saleDate,
        receiptNumber: col.receipt >= 0 ? row[col.receipt]?.trim() || undefined : undefined,
        description: col.description >= 0 ? row[col.description]?.trim() || undefined : undefined,
        productCode: col.productCode >= 0 ? row[col.productCode]?.trim() || undefined : undefined,
        ean: col.ean >= 0 ? row[col.ean]?.trim() || undefined : undefined,
        itemType: col.itemType >= 0 ? row[col.itemType]?.trim() || undefined : undefined,
        quantity,
        totalGrossCents,
        vatRate: Number.isNaN(vatRaw) ? null : vatRaw,
        source: "CSV",
      });
    }

    if (parsed.length === 0) {
      setParseError("Zo súboru sa nepodarilo prečítať žiadne predaje — skontrolujte formát.");
      return;
    }
    setPreview(parsed);
    setReceiptCount(new Set(parsed.map((row) => row.receiptNumber).filter(Boolean)).size);
  };

  return (
    <div className="rounded-[14px] border border-stone-200 bg-white p-5">
      <h2 className="mb-1 font-semibold text-stone-900">VRP2 / eKasa — import predajov</h2>
      <p className="mb-4 text-sm text-stone-500">
        Nahrajte rozšírený report VRP2 v Exceli. Každá položka dokladu sa uloží a opakovaný
        import sa bezpečne preskočí.
      </p>

      <div className="mb-4">
        <label className={label}>Excel VRP2 (.xlsx) alebo CSV</label>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv"
          onChange={(e) => handleFile(e.target.files?.[0])}
          className="w-full text-sm text-stone-600 file:mr-3 file:rounded-[10px] file:border-0 file:bg-stone-950 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-stone-800"
        />
      </div>

      {parseError && <p className={errorBox}>{parseError}</p>}

      {preview.length > 0 && (
        <>
          <p className="mb-3 rounded-[10px] bg-stone-50 px-3 py-2 text-sm text-stone-700">
            Nájdené: <strong>{preview.length} položiek</strong>
            {receiptCount > 0 && <> v <strong>{receiptCount} dokladoch</strong></>}
            {ignoredRows > 0 && <> · ignorované neúplné riadky: {ignoredRows}</>}
            {preview.some((row) => row.vatRate === null) && (
              <> · DPH v reporte nie je uvedená a zostane nezadaná</>
            )}
          </p>
          <div className="mb-3 max-h-72 overflow-auto rounded-[10px] border border-stone-200">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-stone-50">
                <tr className="text-left text-[11px] uppercase tracking-wide text-stone-500">
                  <th className="px-3 py-2 font-medium">Dátum</th>
                  <th className="px-3 py-2 font-medium">Doklad</th>
                  <th className="px-3 py-2 font-medium">Popis</th>
                  <th className="px-3 py-2 font-medium">Kód</th>
                  <th className="px-3 py-2 text-right font-medium">Množstvo</th>
                  <th className="px-3 py-2 text-right font-medium">Suma s DPH</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="border-t border-stone-100">
                    <td className="whitespace-nowrap px-3 py-1.5 text-stone-500">
                      {new Intl.DateTimeFormat("sk-SK", {
                        dateStyle: "short",
                        timeStyle: "short",
                        timeZone: "Europe/Bratislava",
                      }).format(new Date(row.saleDate))}
                    </td>
                    <td className="px-3 py-1.5 text-stone-700">{row.receiptNumber ?? "—"}</td>
                    <td className="px-3 py-1.5 text-stone-900">{row.description ?? "—"}</td>
                    <td className="px-3 py-1.5 text-stone-500">{row.productCode ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{row.quantity}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatCents(row.totalGrossCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={formAction}>
            <input type="hidden" name="rows" value={JSON.stringify(preview)} />
            <input type="hidden" name="importBatch" value={importBatch} />
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? "Importujem…" : `Importovať ${preview.length} položiek`}
            </button>
          </form>
        </>
      )}

      {state.error && <p className={`${errorBox} mt-3`}>{state.error}</p>}
      {state.success && (
        <p className="mt-3 rounded-[10px] bg-[#E7F8E3] px-3 py-2 text-sm text-[#1F7A0F]">{state.success}</p>
      )}
    </div>
  );
}
