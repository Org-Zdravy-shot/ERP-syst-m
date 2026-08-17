"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { formatCents, parseEurToCents } from "@/lib/format";
import { orderChannelLabels } from "@/lib/zod-schemas";
import type { OrderFormState } from "./_actions";
import { resolveUnitPriceCents } from "./pricing";

export interface OrderFormClient {
  id: string;
  name: string;
  type: string;
  productPrices: Array<{ productId: string; unitPriceCents: number }>;
}

export interface OrderFormProduct {
  id: string;
  name: string;
  sku: string;
  priceB2bCents: number | null;
  priceB2cCents: number;
  vatRate: number;
}

interface ItemRow {
  productId: string;
  quantity: string;
  priceEur: string;
  vatRate: number;
}

export interface OrderFormInitial {
  clientId?: string;
  channel?: string;
  deliveryDate?: string; // YYYY-MM-DD
  note?: string;
  items?: Array<{ productId: string; quantity: number; unitPriceCents: number; vatRate: number }>;
}

const inputClass =
  "w-full rounded-[10px] border border-stone-300 px-3 py-2 text-sm focus:border-stone-950 focus:outline-none focus:ring-[3px] focus:ring-brand/35";
const labelClass = "mb-1 block text-sm font-medium text-stone-700";

function centsToEurInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function OrderForm({
  action,
  clients,
  products,
  initial,
  inboxMessageId,
  submitLabel,
  cancelHref,
}: {
  action: (prevState: OrderFormState, formData: FormData) => Promise<OrderFormState>;
  clients: OrderFormClient[];
  products: OrderFormProduct[];
  initial?: OrderFormInitial;
  inboxMessageId?: string;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [rows, setRows] = useState<ItemRow[]>(
    initial?.items?.length
      ? initial.items.map((item) => ({
          productId: item.productId,
          quantity: String(item.quantity),
          priceEur: centsToEurInput(item.unitPriceCents),
          vatRate: item.vatRate,
        }))
      : [{ productId: "", quantity: "1", priceEur: "", vatRate: 20 }],
  );

  const client = clients.find((c) => c.id === clientId);

  function updateRow(index: number, patch: Partial<ItemRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function onProductChange(index: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      updateRow(index, { productId });
      return;
    }
    const priceCents = client
      ? resolveUnitPriceCents(client.type, product, client.productPrices)
      : null;
    updateRow(index, {
      productId,
      priceEur: priceCents === null ? "" : centsToEurInput(priceCents),
      vatRate: product.vatRate,
    });
  }

  function onClientChange(nextClientId: string) {
    const nextClient = clients.find((candidate) => candidate.id === nextClientId);
    setClientId(nextClientId);
    setRows((previous) => previous.map((row) => {
      const product = products.find((candidate) => candidate.id === row.productId);
      if (!product || !nextClient) return { ...row, priceEur: "" };
      const priceCents = resolveUnitPriceCents(nextClient.type, product, nextClient.productPrices);
      return { ...row, priceEur: priceCents === null ? "" : centsToEurInput(priceCents) };
    }));
  }

  function rowCents(row: ItemRow): { net: number; vat: number } | null {
    const qty = Number.parseInt(row.quantity, 10);
    if (!row.productId || Number.isNaN(qty) || qty <= 0) return null;
    let priceCents: number;
    try {
      priceCents = parseEurToCents(row.priceEur);
    } catch {
      return null;
    }
    const net = Math.round(qty * priceCents);
    return { net, vat: Math.round((net * row.vatRate) / 100) };
  }

  const totals = rows.reduce(
    (acc, row) => {
      const cents = rowCents(row);
      if (cents) {
        acc.net += cents.net;
        acc.vat += cents.vat;
      }
      return acc;
    },
    { net: 0, vat: 0 },
  );

  const itemsJson = JSON.stringify(
    rows
      .map((row) => {
        const qty = Number.parseInt(row.quantity, 10);
        let priceCents = NaN;
        try {
          priceCents = parseEurToCents(row.priceEur);
        } catch {
          // neúplný riadok — validáciu dokončí server
        }
        return { productId: row.productId, quantity: qty, unitPriceCents: priceCents, vatRate: row.vatRate };
      })
      .filter((item) => item.productId && Number.isInteger(item.quantity) && Number.isInteger(item.unitPriceCents)),
  );

  return (
    <form action={formAction} className="max-w-3xl space-y-5 rounded-[14px] border border-stone-200 bg-white p-6">
      <input type="hidden" name="items" value={itemsJson} />
      {inboxMessageId && <input type="hidden" name="inboxMessageId" value={inboxMessageId} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="clientId" className={labelClass}>Klient *</label>
          <select
            id="clientId"
            name="clientId"
            required
            value={clientId}
            onChange={(e) => onClientChange(e.target.value)}
            className={inputClass}
          >
            <option value="">— vyberte klienta —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="channel" className={labelClass}>Kanál</label>
          <select id="channel" name="channel" defaultValue={initial?.channel ?? "MANUAL"} className={inputClass}>
            {Object.entries(orderChannelLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="deliveryDate" className={labelClass}>Dátum dodania</label>
          <input id="deliveryDate" name="deliveryDate" type="date" defaultValue={initial?.deliveryDate ?? ""} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="note" className={labelClass}>Poznámka</label>
          <input id="note" name="note" defaultValue={initial?.note ?? ""} className={inputClass} />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-stone-700">Položky *</span>
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, { productId: "", quantity: "1", priceEur: "", vatRate: 20 }])}
            className="rounded-[10px] border border-stone-300 px-3 py-1 text-sm text-stone-700 transition hover:bg-stone-50"
          >
            + Pridať položku
          </button>
        </div>

        <div className="overflow-x-auto rounded-[10px] border border-stone-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
                <th className="px-3 py-2">Produkt</th>
                <th className="w-24 px-3 py-2">Množstvo</th>
                <th className="w-32 px-3 py-2">Cena/ks bez DPH</th>
                <th className="w-20 px-3 py-2">DPH %</th>
                <th className="w-28 px-3 py-2 text-right">Spolu bez DPH</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const cents = rowCents(row);
                const selectedProduct = products.find((product) => product.id === row.productId);
                const missingB2bPrice = !!client && client.type === "B2B" && !!selectedProduct &&
                  resolveUnitPriceCents(client.type, selectedProduct, client.productPrices) === null;
                return (
                  <tr key={index} className="border-b border-stone-100 last:border-0">
                    <td className="px-3 py-2">
                      <select
                        value={row.productId}
                        onChange={(e) => onProductChange(index, e.target.value)}
                        className={inputClass}
                        aria-label={`Produkt ${index + 1}`}
                      >
                        <option value="">— vyberte produkt —</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={row.quantity}
                        onChange={(e) => updateRow(index, { quantity: e.target.value })}
                        className={inputClass}
                        aria-label={`Množstvo ${index + 1}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={row.priceEur}
                        onChange={(e) => updateRow(index, { priceEur: e.target.value })}
                        placeholder="0,00"
                        className={inputClass}
                        aria-label={`Cena ${index + 1}`}
                      />
                      {missingB2bPrice && (
                        <p className="mt-1 text-xs text-amber-700">Cenník klienta nie je nastavený — zadajte cenu ručne.</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={row.vatRate}
                        onChange={(e) => updateRow(index, { vatRate: Number.parseInt(e.target.value, 10) || 0 })}
                        className={inputClass}
                        aria-label={`DPH ${index + 1}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-stone-900">
                      {cents ? formatCents(cents.net) : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                        disabled={rows.length === 1}
                        className="text-stone-400 transition hover:text-red-600 disabled:opacity-30"
                        aria-label={`Odstrániť položku ${index + 1}`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex justify-end">
          <dl className="w-64 space-y-1 text-sm">
            <div className="flex justify-between text-stone-600">
              <dt>Spolu bez DPH</dt>
              <dd>{formatCents(totals.net)}</dd>
            </div>
            <div className="flex justify-between text-stone-600">
              <dt>DPH</dt>
              <dd>{formatCents(totals.vat)}</dd>
            </div>
            <div className="flex justify-between border-t border-stone-200 pt-1 font-semibold text-stone-900">
              <dt>Spolu s DPH</dt>
              <dd>{formatCents(totals.net + totals.vat)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {state.error && <p className="rounded-[10px] bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Ukladám…" : submitLabel}
        </button>
        <Link
          href={cancelHref}
          className="rounded-[10px] border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
        >
          Zrušiť
        </Link>
      </div>
    </form>
  );
}
