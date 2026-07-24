"use client";

import { useActionState } from "react";
import { Badge } from "@/components/Badge";
import { formatDateTime } from "@/lib/format";
import { btnPrimary, btnSecondary, errorBox } from "@/components/ui";
import { sendInvoiceEmailNow, type EmailActionState } from "./email-actions";

interface DeliveryRow {
  id: string;
  toAddress: string;
  subject: string;
  status: string;
  attemptCount: number;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

const STATUS: Record<string, { label: string; color: "emerald" | "yellow" | "red" | "gray" }> = {
  SENT: { label: "Odoslané", color: "emerald" },
  DELIVERED: { label: "Doručené", color: "emerald" },
  PENDING: { label: "Čaká", color: "yellow" },
  FAILED: { label: "Zlyhalo", color: "red" },
  BOUNCED: { label: "Nedoručiteľné", color: "red" },
};

export function InvoiceEmails({
  invoiceId,
  canSend,
  deliveries,
}: {
  invoiceId: string;
  canSend: boolean;
  deliveries: DeliveryRow[];
}) {
  const [state, formAction, pending] = useActionState<EmailActionState, FormData>(
    sendInvoiceEmailNow.bind(null, invoiceId),
    {},
  );

  const hasSent = deliveries.some((d) => d.status === "SENT" || d.status === "DELIVERED");

  return (
    <section className="rounded-[14px] border border-stone-200 bg-white p-5 print:hidden">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-stone-900">E-maily</h2>
        {canSend && (
          <form action={formAction}>
            <button type="submit" disabled={pending} className={hasSent ? btnSecondary : btnPrimary}>
              {pending ? "Odosielam…" : hasSent ? "Poslať znova" : "Poslať e-mailom"}
            </button>
          </form>
        )}
      </div>

      {deliveries.length === 0 ? (
        <p className="text-sm text-stone-400">Faktúra ešte nebola odoslaná e-mailom.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {deliveries.map((delivery) => {
            const s = STATUS[delivery.status] ?? { label: delivery.status, color: "gray" as const };
            return (
              <li key={delivery.id} className="flex items-start justify-between gap-3 border-b border-stone-100 pb-2 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-stone-900">{delivery.toAddress}</div>
                  <div className="text-xs text-stone-400">
                    {formatDateTime(delivery.sentAt ?? delivery.createdAt)}
                    {delivery.attemptCount > 1 && ` · ${delivery.attemptCount}. pokus`}
                  </div>
                  {delivery.status === "FAILED" && delivery.errorMessage && (
                    <div className="mt-0.5 text-xs text-red-600">{delivery.errorMessage}</div>
                  )}
                </div>
                <Badge color={s.color}>{s.label}</Badge>
              </li>
            );
          })}
        </ul>
      )}

      {state.error && <p className={`${errorBox} mt-3`}>{state.error}</p>}
      {state.success && (
        <p className="mt-3 rounded-[10px] bg-[#E7F8E3] px-3 py-2 text-sm text-[#1F7A0F]">{state.success}</p>
      )}
    </section>
  );
}
