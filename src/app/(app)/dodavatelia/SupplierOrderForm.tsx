"use client";

import { useActionState, useMemo, useState } from "react";
import { btnPrimary, btnSmall, btnSmallDanger, errorBox, input, label } from "@/components/ui";
import { formatCents, formatQty } from "@/lib/format";
import type { SupplierOrderFormState } from "./_order-actions";

export type SupplierOrderOffer = {
  id: string;
  supplierId: string;
  name: string;
  supplierSku: string | null;
  unit: string;
  packQuantity: number;
  minOrderQuantity: number;
  orderMultiple: number;
  leadTimeDays: number;
  prices: Array<{
    unitPriceCents: number;
    pricePerQuantity: number;
    minimumQuantity: number;
    priceType: string;
    vatRate: number | null;
    validFrom: string;
    validTo: string | null;
  }>;
};

type SupplierOption = { id: string; name: string };
type InitialOrder = {
  supplierId: string;
  requestedDeliveryDate?: string;
  shipping?: string;
  discount?: string;
  note?: string;
  items: Array<{ catalogItemId: string; quantity: number }>;
};

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b > 0) [a, b] = [b, a % b];
  return a;
}

function defaultQuantity(offer: SupplierOrderOffer): number {
  const scale = 1_000_000;
  const pack = Math.round(offer.packQuantity * scale);
  const multiple = Math.round(offer.orderMultiple * scale);
  const step = ((pack / greatestCommonDivisor(pack, multiple)) * multiple) / scale;
  return Math.ceil(Math.max(offer.minOrderQuantity, step) / step) * step;
}

function currentPrice(offer: SupplierOrderOffer, quantity: number) {
  const now = Date.now();
  return offer.prices
    .filter((price) =>
      price.minimumQuantity <= quantity &&
      new Date(price.validFrom).getTime() <= now &&
      (!price.validTo || new Date(price.validTo).getTime() >= now))
    .sort((left, right) => right.minimumQuantity - left.minimumQuantity)[0] ?? null;
}

function euroInputToCents(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function SupplierOrderForm({
  action,
  suppliers,
  offers,
  initial,
}: {
  action: (state: SupplierOrderFormState, formData: FormData) => Promise<SupplierOrderFormState>;
  suppliers: SupplierOption[];
  offers: SupplierOrderOffer[];
  initial?: InitialOrder;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? suppliers[0]?.id ?? "");
  const supplierOffers = useMemo(() => offers.filter((offer) => offer.supplierId === supplierId), [offers, supplierId]);
  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [items, setItems] = useState(initial?.items ?? []);
  const [shipping, setShipping] = useState(initial?.shipping ?? "0");
  const [discount, setDiscount] = useState(initial?.discount ?? "0");

  const addItem = () => {
    const offer = supplierOffers.find((candidate) => candidate.id === selectedOfferId) ?? supplierOffers[0];
    if (!offer || items.some((item) => item.catalogItemId === offer.id)) return;
    setItems([...items, { catalogItemId: offer.id, quantity: defaultQuantity(offer) }]);
    setSelectedOfferId("");
  };

  const totals = items.reduce(
    (sum, item) => {
      const offer = offers.find((candidate) => candidate.id === item.catalogItemId);
      if (!offer) return sum;
      const price = currentPrice(offer, item.quantity);
      if (!price || price.vatRate === null) return sum;
      if (price.priceType === "NET") {
        const net = Math.round((item.quantity / price.pricePerQuantity) * price.unitPriceCents);
        const vat = Math.round((net * price.vatRate) / 100);
        return { net: sum.net + net, vat: sum.vat + vat, gross: sum.gross + net + vat };
      }
      const gross = Math.round((item.quantity / price.pricePerQuantity) * price.unitPriceCents);
      const net = Math.round((gross * 100) / (100 + price.vatRate));
      return { net: sum.net + net, vat: sum.vat + gross - net, gross: sum.gross + gross };
    },
    { net: 0, vat: 0, gross: 0 },
  );
  const grandTotal = totals.gross + euroInputToCents(shipping) - euroInputToCents(discount);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <section className="rounded-[14px] border border-stone-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className={label}>Dodávateľ *</label>
            <select
              name="supplierId"
              required
              value={supplierId}
              onChange={(event) => {
                setSupplierId(event.target.value);
                setItems([]);
                setSelectedOfferId("");
              }}
              className={input}
            >
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-stone-400">Zmena dodávateľa vyčistí rozpracované položky.</p>
          </div>
          <div>
            <label className={label}>Požadované dodanie</label>
            <input name="requestedDeliveryDate" type="date" defaultValue={initial?.requestedDeliveryDate} className={input} />
          </div>
        </div>
      </section>

      <section className="rounded-[14px] border border-stone-200 bg-white">
        <h2 className="border-b border-stone-100 px-5 py-3 font-semibold text-stone-900">Položky objednávky</h2>
        <div className="flex flex-col gap-2 border-b border-stone-100 p-5 sm:flex-row">
          <select value={selectedOfferId} onChange={(event) => setSelectedOfferId(event.target.value)} className={input}>
            <option value="">Vyberte ponuku…</option>
            {supplierOffers.filter((offer) => !items.some((item) => item.catalogItemId === offer.id)).map((offer) => (
              <option key={offer.id} value={offer.id}>{offer.name}{offer.supplierSku ? ` · ${offer.supplierSku}` : ""}</option>
            ))}
          </select>
          <button type="button" onClick={addItem} className={btnSmall}>+ Pridať položku</button>
        </div>
        <div className="divide-y divide-stone-100">
          {items.map((item, index) => {
            const offer = offers.find((candidate) => candidate.id === item.catalogItemId);
            if (!offer) return null;
            const price = currentPrice(offer, item.quantity);
            return <div key={offer.id} className="grid grid-cols-1 items-center gap-3 px-5 py-4 md:grid-cols-[1fr_160px_220px_auto]">
              <div>
                <div className="font-medium text-stone-900">{offer.name}</div>
                <div className="text-xs text-stone-400">
                  balenie {formatQty(offer.packQuantity, offer.unit)} · minimum {formatQty(offer.minOrderQuantity, offer.unit)} · krok {formatQty(offer.orderMultiple, offer.unit)} · {offer.leadTimeDays} dní
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-stone-400">Množstvo ({offer.unit})</label>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={item.quantity}
                  onChange={(event) => {
                    const quantity = Number(event.target.value.replace(",", "."));
                    setItems(items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, quantity } : candidate));
                  }}
                  className={input}
                />
              </div>
              <div className="text-sm md:text-right">
                {price ? <>
                  <div className="font-semibold text-stone-900">{formatCents(price.unitPriceCents)} / {formatQty(price.pricePerQuantity, offer.unit)}</div>
                  <div className="text-xs text-stone-400">od {formatQty(price.minimumQuantity, offer.unit)} · {price.priceType === "NET" ? "bez DPH" : "s DPH"}{price.vatRate !== null ? ` · DPH ${price.vatRate} %` : " · DPH chýba"}</div>
                </> : <span className="font-semibold text-red-700">Pre množstvo chýba platná cena</span>}
              </div>
              <button type="button" onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))} className={btnSmallDanger}>Odstrániť</button>
            </div>;
          })}
          {items.length === 0 && <p className="px-5 py-10 text-center text-sm text-stone-400">
            {supplierOffers.length ? "Pridajte aspoň jednu ponuku dodávateľa." : "Dodávateľ zatiaľ nemá aktívnu ponuku. Najprv ju doplňte v jeho profile."}
          </p>}
        </div>
      </section>

      <section className="rounded-[14px] border border-stone-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div><label className={label}>Doprava €</label><input name="shipping" inputMode="decimal" value={shipping} onChange={(event) => setShipping(event.target.value)} className={input} /></div>
          <div><label className={label}>Zľava €</label><input name="discount" inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} className={input} /></div>
          <div className="rounded-[10px] bg-stone-950 p-4 text-white">
            <div className="text-xs text-stone-400">Odhad spolu s DPH</div>
            <div className="mt-1 text-xl font-bold">{formatCents(grandTotal)}</div>
            <div className="text-xs text-stone-400">základ {formatCents(totals.net)} · DPH {formatCents(totals.vat)}</div>
          </div>
          <div className="md:col-span-3"><label className={label}>Interná poznámka</label><textarea name="note" rows={3} maxLength={5_000} defaultValue={initial?.note} className={input} /></div>
        </div>
      </section>

      {state.error && <p className={errorBox}>{state.error}</p>}
      {state.success && <p className="rounded-[10px] bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.success}</p>}
      <div className="flex justify-end">
        <button disabled={pending || items.length === 0 || grandTotal < 0} className={btnPrimary}>{pending ? "Ukladám…" : initial ? "Uložiť koncept" : "Vytvoriť koncept objednávky"}</button>
      </div>
    </form>
  );
}
