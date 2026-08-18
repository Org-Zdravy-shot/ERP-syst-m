"use client";

import { useActionState, useMemo, useState } from "react";
import { btnPrimary, btnSmallPrimary, errorBox, input, labelSmall } from "@/components/ui";
import { formatCents, formatQty } from "@/lib/format";
import { recommendedOrderQuantity } from "@/lib/suppliers/domain";
import { createReplenishmentDrafts, updateStockTarget, type SupplierOrderFormState } from "./_order-actions";

type ReplenishmentOffer = {
  id: string;
  supplierId: string;
  supplierName: string;
  name: string;
  unit: string;
  isPreferred: boolean;
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

export type ReplenishmentItem = {
  key: string;
  kind: "material" | "product";
  id: string;
  name: string;
  unit: string;
  currentQuantity: number;
  openOrderQuantity: number;
  minStock: number;
  targetStock: number | null;
  offers: ReplenishmentOffer[];
};

function selectedDefault(item: ReplenishmentItem): string {
  const preferred = item.offers.filter((offer) => offer.isPreferred);
  return preferred.length === 1 ? preferred[0].id : "";
}

function recommendation(item: ReplenishmentItem, offer: ReplenishmentOffer | undefined): number {
  if (!offer) return 0;
  return recommendedOrderQuantity({
    currentQuantity: item.currentQuantity,
    openOrderQuantity: item.openOrderQuantity,
    minStock: item.minStock,
    targetStock: item.targetStock,
    minOrderQuantity: offer.minOrderQuantity,
    packQuantity: offer.packQuantity,
    orderMultiple: offer.orderMultiple,
  });
}

function activePrice(offer: ReplenishmentOffer | undefined, quantity: number) {
  if (!offer) return null;
  const now = Date.now();
  return offer.prices
    .filter((price) => price.minimumQuantity <= quantity && new Date(price.validFrom).getTime() <= now && (!price.validTo || new Date(price.validTo).getTime() >= now))
    .sort((left, right) => right.minimumQuantity - left.minimumQuantity)[0] ?? null;
}

function priceGrossCents(offer: ReplenishmentOffer, quantity: number): number | null {
  const price = activePrice(offer, quantity);
  if (!price || price.vatRate === null) return null;
  if (price.priceType === "GROSS") return Math.round((quantity / price.pricePerQuantity) * price.unitPriceCents);
  if (price.priceType === "NET") {
    const net = Math.round((quantity / price.pricePerQuantity) * price.unitPriceCents);
    return net + Math.round((net * price.vatRate) / 100);
  }
  return null;
}

export function ReplenishmentPlanner({ items }: { items: ReplenishmentItem[] }) {
  const [state, formAction, pending] = useActionState(createReplenishmentDrafts, {});
  const [selected, setSelected] = useState<Record<string, string>>(
    Object.fromEntries(items.map((item) => [item.key, selectedDefault(item)])),
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(items.map((item) => {
    const offer = item.offers.find((candidate) => candidate.id === selectedDefault(item));
    return [item.key, recommendation(item, offer)];
  })));
  const [included, setIncluded] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map((item) => {
    const offer = item.offers.find((candidate) => candidate.id === selectedDefault(item));
    const quantity = recommendation(item, offer);
    return [item.key, quantity > 0 && priceGrossCents(offer!, quantity) !== null];
  })));

  const selectedLines = useMemo(() => items.flatMap((item) => {
    const offer = item.offers.find((candidate) => candidate.id === selected[item.key]);
    const quantity = quantities[item.key] ?? 0;
    if (!included[item.key] || !offer || quantity <= 0 || priceGrossCents(offer, quantity) === null) return [];
    return [{ kind: item.kind, itemId: item.id, catalogItemId: offer.id, quantity }];
  }), [included, items, quantities, selected]);
  const supplierCount = new Set(selectedLines.map((line) => items.find((item) => item.id === line.itemId)?.offers.find((offer) => offer.id === line.catalogItemId)?.supplierId)).size;
  const estimatedGross = selectedLines.reduce((sum, line) => {
    const item = items.find((candidate) => candidate.id === line.itemId)!;
    const offer = item.offers.find((candidate) => candidate.id === line.catalogItemId)!;
    return sum + (priceGrossCents(offer, line.quantity) ?? 0);
  }, 0);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="items" value={JSON.stringify(selectedLines)} />
      <div className="space-y-3">
        {items.map((item) => {
          const offer = item.offers.find((candidate) => candidate.id === selected[item.key]);
          const quantity = quantities[item.key] ?? 0;
          const suggested = recommendation(item, offer);
          const price = activePrice(offer, quantity);
          const validPrice = offer ? priceGrossCents(offer, quantity) : null;
          const covered = item.currentQuantity + item.openOrderQuantity >= item.minStock;
          return <div key={item.key} className={`rounded-[14px] border bg-white p-4 ${included[item.key] ? "border-amber-300 ring-2 ring-amber-100" : "border-stone-200"}`}>
            <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-[28px_1.2fr_1fr_160px_220px]">
              <input
                type="checkbox"
                aria-label={`Zahrnúť ${item.name}`}
                checked={included[item.key] ?? false}
                disabled={!offer || suggested === 0 || validPrice === null}
                onChange={(event) => setIncluded({ ...included, [item.key]: event.target.checked })}
              />
              <div>
                <div className="font-semibold text-stone-900">{item.name}</div>
                <div className="mt-1 text-xs text-stone-400">
                  sklad {formatQty(item.currentQuantity, item.unit)} · otvorené objednávky {formatQty(item.openOrderQuantity, item.unit)} · minimum {formatQty(item.minStock, item.unit)} · cieľ {formatQty(item.targetStock ?? item.minStock, item.unit)}
                </div>
                {covered && <div className="mt-1 text-xs font-semibold text-emerald-700">Nízky fyzický stav už pokrýva otvorená objednávka.</div>}
              </div>
              <div>
                <label className={labelSmall}>Ponuka dodávateľa</label>
                <select
                  value={selected[item.key] ?? ""}
                  onChange={(event) => {
                    const offerId = event.target.value;
                    const nextOffer = item.offers.find((candidate) => candidate.id === offerId);
                    const nextQuantity = recommendation(item, nextOffer);
                    setSelected({ ...selected, [item.key]: offerId });
                    setQuantities({ ...quantities, [item.key]: nextQuantity });
                    setIncluded({ ...included, [item.key]: nextQuantity > 0 && !!nextOffer && priceGrossCents(nextOffer, nextQuantity) !== null });
                  }}
                  className={input}
                >
                  <option value="">Vyberte dodávateľa…</option>
                  {item.offers.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.supplierName} · {candidate.name}{candidate.isPreferred ? " · preferovaný" : ""}</option>)}
                </select>
                {item.offers.length === 0 && <div className="mt-1 text-xs font-semibold text-red-700">Chýba aktívna ponuka.</div>}
                {item.offers.length > 0 && !selected[item.key] && <div className="mt-1 text-xs text-amber-700">Vyberte jednu z {item.offers.length} alternatív.</div>}
              </div>
              <div>
                <label className={labelSmall}>Objednať ({item.unit})</label>
                <input type="number" step="any" min={suggested || 0} value={quantity} disabled={!offer || covered} onChange={(event) => setQuantities({ ...quantities, [item.key]: Number(event.target.value) })} className={input} />
                {suggested > 0 && <div className="mt-1 text-xs text-stone-400">odporúčanie {formatQty(suggested, item.unit)}</div>}
              </div>
              <div className="text-sm lg:text-right">
                {price ? <>
                  <div className="font-semibold text-stone-900">{formatCents(price.unitPriceCents)} / {formatQty(price.pricePerQuantity, item.unit)}</div>
                  <div className="text-xs text-stone-400">{offer?.supplierName} · dodanie {offer?.leadTimeDays} dní</div>
                  {validPrice === null && <div className="text-xs font-semibold text-red-700">Cena nemá platný typ alebo DPH.</div>}
                </> : offer ? <div className="font-semibold text-red-700">Pre množstvo chýba cena.</div> : <span className="text-stone-400">—</span>}
              </div>
            </div>
          </div>;
        })}
      </div>

      {items.length === 0 && <div className="rounded-[14px] border border-emerald-200 bg-emerald-50 p-8 text-center text-emerald-800">Žiadna položka nie je pod minimálnou zásobou.</div>}
      {state.error && <p className={errorBox}>{state.error}</p>}
      <div className="flex flex-col items-end gap-2 rounded-[14px] bg-stone-950 p-5 text-white sm:flex-row sm:justify-between">
        <div><div className="text-sm font-semibold">Vybrané: {selectedLines.length} položiek pre {supplierCount} dodávateľov</div><div className="text-xs text-stone-400">Odhad s DPH {formatCents(estimatedGross)} · vzniknú iba koncepty</div></div>
        <button disabled={pending || selectedLines.length === 0} className={btnPrimary}>{pending ? "Vytváram…" : "Vytvoriť koncepty podľa dodávateľov"}</button>
      </div>
    </form>
  );
}

export function StockTargetForm({
  itemRef,
  minStock,
  targetStock,
  unit,
}: {
  itemRef: string;
  minStock: number;
  targetStock: number | null;
  unit: string;
}) {
  const [state, formAction, pending] = useActionState(updateStockTarget.bind(null, itemRef), {} as SupplierOrderFormState);
  return <form action={formAction} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
    <div><label className={labelSmall}>Minimum ({unit})</label><input name="minStock" type="number" step="any" min={0} required defaultValue={minStock} className={input} /></div>
    <div><label className={labelSmall}>Cieľ ({unit})</label><input name="targetStock" type="number" step="any" min={0} defaultValue={targetStock ?? ""} className={input} /></div>
    <button disabled={pending} className={btnSmallPrimary}>{pending ? "…" : "Uložiť"}</button>
    {state.error && <p className={`${errorBox} col-span-3`}>{state.error}</p>}
    {state.success && <p className="col-span-3 text-xs text-emerald-700">{state.success}</p>}
  </form>;
}
