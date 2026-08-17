"use client";

import { useActionState } from "react";
import { formatCents } from "@/lib/format";
import type { ClientProductPriceFormState } from "./_actions";

interface ClientPriceProduct {
  id: string;
  name: string;
  sku: string;
  priceB2cCents: number;
  unitPriceCents: number | null;
}

function centsToInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

export function ClientPriceListForm({
  action,
  products,
}: {
  action: (
    state: ClientProductPriceFormState,
    formData: FormData,
  ) => Promise<ClientProductPriceFormState>;
  products: ClientPriceProduct[];
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="rounded-[14px] border border-stone-200 bg-white">
      <div className="border-b border-stone-100 px-5 py-3">
        <h2 className="font-semibold text-stone-900">Individuálny B2B cenník</h2>
        <p className="mt-1 text-xs text-stone-500">
          Prázdna cena znamená „nenastavená“ — v objednávke ju bude treba zadať ručne.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
              <th className="px-5 py-2">Produkt</th>
              <th className="px-5 py-2 text-right">B2C referencia</th>
              <th className="px-5 py-2 text-right">B2B bez DPH</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-stone-50 last:border-0">
                <td className="px-5 py-2.5">
                  <span className="font-medium text-stone-900">{product.name}</span>
                  <span className="ml-2 text-xs text-stone-400">{product.sku}</span>
                </td>
                <td className="px-5 py-2.5 text-right text-stone-500">
                  {formatCents(product.priceB2cCents)}
                </td>
                <td className="px-5 py-2.5 text-right">
                  <input
                    name={`price:${product.id}`}
                    inputMode="decimal"
                    defaultValue={centsToInput(product.unitPriceCents)}
                    placeholder="nenastavená"
                    aria-label={`B2B cena ${product.name}`}
                    className="w-32 rounded-[10px] border border-stone-300 px-3 py-2 text-right text-sm tabular-nums focus:border-stone-950 focus:outline-none focus:ring-[3px] focus:ring-brand/35"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 px-5 py-3">
        <div aria-live="polite">
          {state.error && <p className="text-sm text-red-700">{state.error}</p>}
          {state.success && <p className="text-sm text-[#1F7A0F]">{state.success}</p>}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Ukladám…" : "Uložiť B2B cenník"}
        </button>
      </div>
    </form>
  );
}
