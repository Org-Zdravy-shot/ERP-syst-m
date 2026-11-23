"use client";

import { useActionState } from "react";
import { btnSecondary, errorBox, input, label } from "@/components/ui";
import { cancelDeliveryNoteAction, type DeliveryFormState } from "../_actions";

export function CancelDeliveryNote({ id }: { id: string }) {
  const [state, action, pending] = useActionState<DeliveryFormState, FormData>(cancelDeliveryNoteAction.bind(null, id), {});
  return <details className="rounded-xl border border-stone-200 bg-white p-4 print:hidden">
    <summary className="cursor-pointer text-sm font-semibold text-red-700">Zrušiť dodací list</summary>
    <form action={action} className="mt-3 space-y-3">
      <label className={label}>Dôvod zrušenia<input className={input} name="reason" required maxLength={500} /></label>
      {state.error && <p role="alert" className={errorBox}>{state.error}</p>}
      <button type="submit" className={btnSecondary} disabled={pending}>{pending ? "Ruším…" : "Potvrdiť zrušenie"}</button>
    </form>
  </details>;
}
