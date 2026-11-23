"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { btnPrimary, btnSecondary, errorBox, input, label } from "@/components/ui";
import { quoteDecisionAction, quoteToInvoiceAction, quoteToOrderAction } from "../_actions";

export function QuoteActions({ id, status, hasDocument, canMakeOrder, startDate }: {
  id: string; status: string; hasDocument: boolean; canMakeOrder: boolean; startDate: string;
}) {
  const [state, decision, pending] = useActionState(quoteDecisionAction.bind(null, id), {});
  const [invoiceState, invoice, invoicePending] = useActionState(quoteToInvoiceAction.bind(null, id), {});
  const [orderState, order, orderPending] = useActionState(quoteToOrderAction.bind(null, id), {});
  const [dates, setDates] = useState({
    issueDate: startDate, deliveryDate: startDate,
    dueDate: new Date(new Date(startDate).getTime() + 14 * 86_400_000).toISOString().slice(0, 10),
  });
  const [orderDate, setOrderDate] = useState(startDate);
  if (hasDocument) return null;
  return <div className="space-y-4">
    <form action={decision} className="flex flex-wrap gap-2">
      {status !== "ACCEPTED" && <button name="decision" value="ACCEPTED" className={btnPrimary} disabled={pending}>Označiť ako schválenú</button>}
      {status !== "REJECTED" && <button name="decision" value="REJECTED" className={btnSecondary} disabled={pending}>Označiť ako zamietnutú</button>}
      {status !== "PENDING" && <button name="decision" value="PENDING" className={btnSecondary} disabled={pending}>Vrátiť na schválenie</button>}
      {state.error && <p role="alert" className={errorBox}>{state.error}</p>}
    </form>
    {status === "ACCEPTED" && <>
      <Link className={btnSecondary} href={`/financie/dodacie-listy/novy?quote=${id}`}>Vytvoriť dodací list</Link>
      <details className="rounded-xl border border-stone-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold">Vytvoriť faktúru</summary>
        <form action={invoice} className="mt-3 space-y-2">
          {([["issueDate","Vystavenie"],["deliveryDate","Dodanie"],["dueDate","Splatnosť"]] as const).map(([key,title]) => <label className={label} key={key}>{title}
            <input name={key} type="date" required className={input} value={dates[key]} onChange={event => setDates({ ...dates, [key]: event.target.value })} />
          </label>)}
          {invoiceState.error && <p className={errorBox} role="alert">{invoiceState.error}</p>}
          <button disabled={invoicePending} className={btnPrimary}>Vytvoriť koncept</button>
        </form>
      </details>
      {canMakeOrder && <details className="rounded-xl border border-stone-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold">Vytvoriť objednávku</summary>
        <form action={order} className="mt-3 space-y-2">
          <label className={label}>Dátum objednávky<input required type="date" className={input} name="orderDate" value={orderDate} onChange={event => setOrderDate(event.target.value)} /></label>
          {orderState.error && <p className={errorBox} role="alert">{orderState.error}</p>}
          <button disabled={orderPending} className={btnPrimary}>Vytvoriť objednávku</button>
        </form>
      </details>}
    </>}
  </div>;
}
