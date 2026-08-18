"use client";

import { useActionState } from "react";
import { Badge } from "@/components/Badge";
import { formatDateTime } from "@/lib/format";
import { btnPrimary, errorBox } from "@/components/ui";
import {
  validateEInvoiceNow,
  type EInvoiceActionState,
} from "./einvoice-actions";

interface TransmissionRow {
  id: string;
  mode: string;
  status: string;
  receiverPeppolId: string;
  ublSha256: string;
  lastError: string | null;
  validatedAt: string | null;
  submittedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  ublDocument: { id: string; fileName: string };
}

const STATUS: Record<
  string,
  { label: string; color: "emerald" | "yellow" | "red" | "gray" }
> = {
  PENDING: { label: "Čaká na validáciu", color: "yellow" },
  VALIDATED: { label: "UBL validné", color: "emerald" },
  QUEUED: { label: "Zaradené", color: "yellow" },
  SENT: { label: "Odoslané", color: "emerald" },
  DELIVERED: { label: "Doručené", color: "emerald" },
  REJECTED: { label: "Zamietnuté", color: "red" },
  FAILED: { label: "Zlyhalo", color: "red" },
};

export function InvoiceEInvoice({
  invoiceId,
  canValidate,
  disabledReason,
  transmissions,
}: {
  invoiceId: string;
  canValidate: boolean;
  disabledReason?: string;
  transmissions: TransmissionRow[];
}) {
  const [state, action, pending] = useActionState<
    EInvoiceActionState,
    FormData
  >(validateEInvoiceNow.bind(null, invoiceId), {});

  return (
    <section className="rounded-[14px] border border-stone-200 bg-white p-5 print:hidden">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-stone-900">eFaktúra</h2>
          <p className="mt-0.5 text-xs text-stone-500">
            Peppol UBL · najprv iba sandbox validácia
          </p>
        </div>
        {canValidate && (
          <form action={action}>
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? "Overujem…" : "Pripraviť a overiť UBL"}
            </button>
          </form>
        )}
      </div>

      {!canValidate && disabledReason && (
        <p className="mt-3 rounded-[10px] bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          {disabledReason}
        </p>
      )}
      {state.error && <p className={`${errorBox} mt-3`}>{state.error}</p>}
      {state.success && (
        <p className="mt-3 rounded-[10px] bg-[#E7F8E3] px-3 py-2 text-sm text-[#1F7A0F]">
          {state.success}
        </p>
      )}

      {transmissions.length === 0 ? (
        <p className="mt-3 text-sm text-stone-400">
          K dokladu zatiaľ nebolo vytvorené UBL.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {transmissions.map((transmission) => {
            const status = STATUS[transmission.status] ?? {
              label: transmission.status,
              color: "gray" as const,
            };
            const statusAt =
              transmission.deliveredAt ??
              transmission.submittedAt ??
              transmission.validatedAt ??
              transmission.createdAt;
            return (
              <li
                key={transmission.id}
                className="rounded-[10px] border border-stone-100 bg-stone-50 p-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge color={status.color}>{status.label}</Badge>
                    <span className="font-medium text-stone-700">
                      {transmission.mode === "SANDBOX" ? "Sandbox" : "Produkcia"}
                    </span>
                  </div>
                  <span className="text-stone-400">
                    {formatDateTime(statusAt)}
                  </span>
                </div>
                <dl className="mt-2 space-y-1 text-stone-500">
                  <div className="flex justify-between gap-3">
                    <dt>Príjemca</dt>
                    <dd className="font-mono text-stone-700">
                      {transmission.receiverPeppolId}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>UBL</dt>
                    <dd>
                      <a
                        href={`/api/financie/dokumenty/${transmission.ublDocument.id}`}
                        className="font-medium text-stone-800 hover:underline"
                      >
                        {transmission.ublDocument.fileName}
                      </a>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>SHA-256</dt>
                    <dd className="max-w-[13rem] truncate font-mono text-stone-700" title={transmission.ublSha256}>
                      {transmission.ublSha256}
                    </dd>
                  </div>
                </dl>
                {transmission.lastError && (
                  <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-red-700">
                    {transmission.lastError}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
