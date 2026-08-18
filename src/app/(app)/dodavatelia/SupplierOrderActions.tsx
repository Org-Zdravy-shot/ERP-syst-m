"use client";

import { useActionState, useState } from "react";
import { btnDanger, btnPrimary, btnSecondary, errorBox, input, labelSmall } from "@/components/ui";
import { formatQty } from "@/lib/format";
import type { SupplierOrderStatus } from "@/lib/suppliers/domain";
import { supplierOrderStatusLabels } from "@/lib/zod-schemas";
import type { SupplierOrderFormState } from "./_order-actions";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function TransitionForm({
  to,
  action,
}: {
  to: SupplierOrderStatus;
  action: (state: SupplierOrderFormState, formData: FormData) => Promise<SupplierOrderFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const buttonClass = to === "CANCELLED" ? btnDanger : to === "APPROVED" || to === "SENT" ? btnPrimary : btnSecondary;
  return (
    <form action={formAction} className="space-y-2 rounded-[10px] border border-stone-100 p-3">
      {to === "CONFIRMED" && <div><label className={labelSmall}>Dodávateľ potvrdil termín</label><input name="confirmedDeliveryDate" type="date" className={input} /></div>}
      {to === "CANCELLED" && <div><label className={labelSmall}>Dôvod zrušenia *</label><input name="cancelReason" required maxLength={500} className={input} /></div>}
      <button disabled={pending} className={buttonClass}>{pending ? "Ukladám…" : to === "CANCELLED" ? "Zrušiť objednávku" : `Nastaviť: ${supplierOrderStatusLabels[to] ?? to}`}</button>
      {state.error && <p className={errorBox}>{state.error}</p>}
      {state.success && <p className="rounded-[10px] bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.success}</p>}
    </form>
  );
}

export function SupplierOrderTransitions({
  transitions,
}: {
  transitions: Array<{
    to: SupplierOrderStatus;
    action: (state: SupplierOrderFormState, formData: FormData) => Promise<SupplierOrderFormState>;
  }>;
}) {
  if (!transitions.length) return <p className="text-sm text-stone-400">Pre vašu rolu nie je dostupná žiadna zmena stavu.</p>;
  return <div className="space-y-3">{transitions.map((transition) => <TransitionForm key={transition.to} {...transition} />)}</div>;
}

type ReceiptItem = {
  id: string;
  description: string;
  unit: string;
  orderedQuantity: number;
  receivedQuantity: number;
};

type ReturnableOption = {
  id: string;
  name: string;
  unit: string;
  expectedReturnDays: number | null;
};

export function SupplierReceiptForm({
  action,
  idempotencyKey,
  items,
  returnables,
}: {
  action: (state: SupplierOrderFormState, formData: FormData) => Promise<SupplierOrderFormState>;
  idempotencyKey: string;
  items: ReceiptItem[];
  returnables: ReturnableOption[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [quantities, setQuantities] = useState<Record<string, number>>(Object.fromEntries(items.map((item) => [item.id, 0])));
  const [returnableQuantities, setReturnableQuantities] = useState<Record<string, number>>(Object.fromEntries(returnables.map((item) => [item.id, 0])));
  const [returnableDueDates, setReturnableDueDates] = useState<Record<string, string>>({});
  const receiptItems = items.map((item) => ({ orderItemId: item.id, quantity: quantities[item.id] ?? 0 }));
  const receiptReturnables = returnables.map((item) => ({
    returnableTypeId: item.id,
    quantity: returnableQuantities[item.id] ?? 0,
    dueDate: returnableDueDates[item.id] || undefined,
  }));

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="items" value={JSON.stringify(receiptItems)} />
      <input type="hidden" name="returnables" value={JSON.stringify(receiptReturnables)} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><label className={labelSmall}>Dátum príjmu *</label><input name="receivedAt" type="date" required defaultValue={today()} className={input} /></div>
        <div><label className={labelSmall}>Číslo dodacieho listu</label><input name="deliveryNoteNumber" maxLength={255} className={input} /></div>
        <div><label className={labelSmall}>Poznámka</label><input name="note" maxLength={5_000} className={input} /></div>
      </div>

      <div className="divide-y divide-stone-100 rounded-[10px] border border-stone-100">
        {items.map((item) => {
          const remaining = item.orderedQuantity - item.receivedQuantity;
          return <div key={item.id} className="grid grid-cols-1 items-center gap-2 p-3 sm:grid-cols-[1fr_180px]">
            <div>
              <div className="text-sm font-medium text-stone-900">{item.description}</div>
              <div className="text-xs text-stone-400">objednané {formatQty(item.orderedQuantity, item.unit)} · prijaté {formatQty(item.receivedQuantity, item.unit)} · zostáva {formatQty(remaining, item.unit)}</div>
            </div>
            <div><label className={labelSmall}>Teraz prijímam ({item.unit})</label><input
              type="number"
              step="any"
              inputMode="decimal"
              min={0}
              max={remaining}
              value={quantities[item.id] ?? 0}
              onChange={(event) => setQuantities({ ...quantities, [item.id]: Number(event.target.value.replace(",", ".")) })}
              className={input}
            /></div>
          </div>;
        })}
      </div>

      {returnables.length > 0 && <details className="rounded-[10px] border border-amber-200 bg-amber-50 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-amber-900">Prišli aj vratné obaly alebo nádoby?</summary>
        <div className="mt-3 space-y-3">
          {returnables.map((item) => <div key={item.id} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_150px_180px]">
            <div className="text-sm text-stone-800">{item.name}</div>
            <div><label className={labelSmall}>Počet ({item.unit})</label><input type="number" step="any" inputMode="decimal" min={0} value={returnableQuantities[item.id] ?? 0} onChange={(event) => setReturnableQuantities({ ...returnableQuantities, [item.id]: Number(event.target.value.replace(",", ".")) })} className={input} /></div>
            <div><label className={labelSmall}>Vrátiť do</label><input type="date" value={returnableDueDates[item.id] ?? ""} onChange={(event) => setReturnableDueDates({ ...returnableDueDates, [item.id]: event.target.value })} className={input} /></div>
          </div>)}
        </div>
      </details>}

      {state.error && <p className={errorBox}>{state.error}</p>}
      {state.success && <p className="rounded-[10px] bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.success}</p>}
      <button disabled={pending} className={btnPrimary}>{pending ? "Prijímam…" : "Potvrdiť príjem a zapísať sklad"}</button>
    </form>
  );
}
