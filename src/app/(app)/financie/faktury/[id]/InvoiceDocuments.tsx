"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { btnSmallPrimary } from "@/components/ui";

interface InvoiceDocumentItem {
  id: string;
  type: string;
  fileName: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 1 }).format(bytes / 1024)} kB`;
}

export function InvoiceDocuments({
  invoiceId,
  documents,
  allowPdfGeneration,
  canGenerate,
  canUploadAttachment,
}: {
  invoiceId: string;
  documents: InvoiceDocumentItem[];
  allowPdfGeneration: boolean;
  canGenerate: boolean;
  canUploadAttachment: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function generatePdf() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/financie/faktury/${encodeURIComponent(invoiceId)}/dokumenty`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "PDF sa nepodarilo vygenerovať.");
      }
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "PDF sa nepodarilo vygenerovať.",
      );
    } finally {
      setPending(false);
    }
  }

  async function uploadAttachment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("attachment");
    if (!(file instanceof File) || file.size === 0) {
      setError("Vyberte PDF, JPG alebo PNG prílohu.");
      return;
    }

    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/financie/faktury/${encodeURIComponent(invoiceId)}/dokumenty?typ=priloha`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": file.type || "application/octet-stream",
            "X-File-Name-Encoded": encodeURIComponent(file.name),
          },
          body: file,
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Prílohu sa nepodarilo nahrať.");
      }
      form.reset();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Prílohu sa nepodarilo nahrať.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-[14px] border border-stone-200 bg-white p-5 print:hidden">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-stone-900">Dokumenty</h2>
        {allowPdfGeneration && (
          <button
            type="button"
            className={btnSmallPrimary}
            disabled={!canGenerate || pending}
            onClick={generatePdf}
          >
            {pending ? "Pracujem…" : "Vygenerovať PDF"}
          </button>
        )}
      </div>

      {allowPdfGeneration && !canGenerate && (
        <p className="mt-3 text-xs leading-5 text-stone-500">
          Nemenné PDF je možné vytvoriť až po finalizácii dokladu a uložení
          snapshotov.
        </p>
      )}

      {canUploadAttachment && (
        <form
          className="mt-3 rounded-[10px] border border-dashed border-stone-300 bg-stone-50 p-3"
          onSubmit={uploadAttachment}
        >
          <label
            htmlFor="invoice-attachment"
            className="mb-1.5 block text-xs font-medium text-stone-700"
          >
            Príloha prijatej faktúry
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id="invoice-attachment"
              name="attachment"
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              required
              disabled={pending}
              className="min-w-0 flex-1 text-xs text-stone-600 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-stone-700"
            />
            <button
              type="submit"
              className={btnSmallPrimary}
              disabled={pending}
            >
              {pending ? "Nahrávam…" : "Nahrať prílohu"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-stone-500">
            PDF, JPG alebo PNG, najviac 10 MB. Súbor sa uloží nemenne do
            súkromného archívu.
          </p>
        </form>
      )}

      {error && (
        <p className="mt-3 rounded-[10px] bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {documents.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">
          K faktúre zatiaľ nie je uložený žiadny dokument.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-stone-900">
                  {document.fileName}
                </p>
                <p className="mt-0.5 text-[11px] text-stone-500">
                  {document.type === "ATTACHMENT" ? "Príloha" : "Nemenné PDF"}
                  {" · "}{formatBytes(document.byteSize)} · SHA-256{" "}
                  {document.sha256.slice(0, 12)}…
                </p>
              </div>
              <a
                href={`/api/financie/dokumenty/${document.id}`}
                className="shrink-0 text-xs font-semibold text-stone-700 underline decoration-stone-300 underline-offset-4 hover:text-stone-950"
              >
                Stiahnuť
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
