"use client";

import { useActionState } from "react";
import type { InvoiceFormState } from "../../_actions";

export function VerifyHistoricalButton({ action }: { action: (prev: InvoiceFormState, formData: FormData) => Promise<InvoiceFormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return <form action={formAction} className="mt-3"><button type="submit" disabled={pending} className="rounded-[10px] border border-stone-300 px-3 py-2 text-sm">{pending ? "Overujem…" : "Potvrdiť kontrolu originálu"}</button>{state.error && <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>}{state.success && <p role="status" className="mt-2 text-sm text-green-800">{state.success}</p>}</form>;
}
