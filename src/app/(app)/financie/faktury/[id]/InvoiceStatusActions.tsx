"use client";

import { useActionState } from "react";
import type { InvoiceFormState } from "../../_actions";
import { btnPrimary, btnDanger, errorBox } from "@/components/ui";

export function InvoiceWorkflowActions({
  canFinalize,
  canCancel,
  canCredit,
  defaultIssueDate,
  defaultDueDate,
  finalizeAction,
  cancelAction,
  creditNoteAction,
}: {
  canFinalize: boolean;
  canCancel: boolean;
  canCredit: boolean;
  defaultIssueDate: string;
  defaultDueDate: string;
  finalizeAction: (prevState: InvoiceFormState, formData: FormData) => Promise<InvoiceFormState>;
  cancelAction: (prevState: InvoiceFormState, formData: FormData) => Promise<InvoiceFormState>;
  creditNoteAction: (prevState: InvoiceFormState, formData: FormData) => Promise<InvoiceFormState>;
}) {
  const [finalizeState, finalizeFormAction, finalizePending] = useActionState(finalizeAction, {});
  const [cancelState, cancelFormAction, cancelPending] = useActionState(cancelAction, {});
  const [creditState, creditFormAction, creditPending] = useActionState(creditNoteAction, {});

  return (
    <div className="space-y-4 print:hidden">
      {canFinalize && (
        <form action={finalizeFormAction}>
          <button type="submit" disabled={finalizePending} className={btnPrimary}>
            {finalizePending ? "Vystavujem…" : "Skontrolovať a vystaviť doklad"}
          </button>
          <p className="mt-2 text-xs text-stone-500">
            Vystavením sa pridelí číslo dokladu a uložia sa údaje pre PDF.
          </p>
        </form>
      )}

      {canCredit && (
        <form action={creditFormAction} className="space-y-3 border-t border-stone-100 pt-4">
          <h3 className="text-sm font-semibold text-stone-900">Vytvoriť plný dobropis</h3>
          <div>
            <label className="block text-xs font-medium text-stone-600" htmlFor="credit-reason">
              Dôvod dobropisu
            </label>
            <input
              id="credit-reason"
              name="reason"
              required
              className="mt-1 w-full rounded-[10px] border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid gap-2">
            <div>
              <label className="block text-xs text-stone-600" htmlFor="credit-issue-date">Vystavenie</label>
              <input
                id="credit-issue-date"
                name="issueDate"
                type="date"
                required
                defaultValue={defaultIssueDate}
                className="mt-1 w-full rounded-[8px] border border-stone-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-600" htmlFor="credit-delivery-date">Dodanie</label>
              <input
                id="credit-delivery-date"
                name="deliveryDate"
                type="date"
                required
                defaultValue={defaultIssueDate}
                className="mt-1 w-full rounded-[8px] border border-stone-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-600" htmlFor="credit-due-date">Splatnosť</label>
              <input
                id="credit-due-date"
                name="dueDate"
                type="date"
                required
                defaultValue={defaultDueDate}
                className="mt-1 w-full rounded-[8px] border border-stone-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <button type="submit" disabled={creditPending} className={btnPrimary}>
            {creditPending ? "Vytváram…" : "Vytvoriť koncept dobropisu"}
          </button>
        </form>
      )}

      {canCancel && (
        <form action={cancelFormAction} className="space-y-2 border-t border-stone-100 pt-4">
          <label className="block text-xs font-medium text-stone-600" htmlFor="cancel-reason">
            Dôvod storna
          </label>
          <input
            id="cancel-reason"
            name="reason"
            required
            className="w-full rounded-[10px] border border-stone-300 px-3 py-2 text-sm"
          />
          <button type="submit" disabled={cancelPending} className={btnDanger}>
            {cancelPending ? "Stornujem…" : "Stornovať doklad"}
          </button>
        </form>
      )}

      {finalizeState.error && <p className={errorBox}>{finalizeState.error}</p>}
      {creditState.error && <p className={errorBox}>{creditState.error}</p>}
      {cancelState.error && <p className={errorBox}>{cancelState.error}</p>}
      {(finalizeState.success || cancelState.success) && (
        <p className="rounded-[10px] bg-[#E7F8E3] px-3 py-2 text-sm text-[#1F7A0F]">
          {finalizeState.success ?? cancelState.success}
        </p>
      )}
    </div>
  );
}
