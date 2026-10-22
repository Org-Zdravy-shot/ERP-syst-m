"use client";

import { useActionState } from "react";
import type { MatchState } from "./_actions";

export function MatchForm({
  action, label,
}: {
  action: (state: MatchState, formData: FormData) => Promise<MatchState>;
  label: "match" | "unmatch";
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return <form action={formAction} className="flex min-w-52 flex-col gap-1">
    <div className="flex gap-1">
      {label === "match" && <input name="invoiceNumber" required placeholder="Číslo faktúry" aria-label="Číslo faktúry na párovanie" className="w-32 rounded border border-stone-300 px-2 py-1 text-xs" />}
      <button disabled={pending} className="rounded border border-stone-300 px-2 py-1 text-xs font-medium hover:bg-stone-50 disabled:opacity-50">
        {pending ? "Ukladám…" : label === "match" ? "Spárovať" : "Zrušiť párovanie"}
      </button>
    </div>
    <div aria-live="polite">{state.error && <span className="text-xs text-red-700">{state.error}</span>}{state.success && <span className="text-xs text-green-700">{state.success}</span>}</div>
  </form>;
}
