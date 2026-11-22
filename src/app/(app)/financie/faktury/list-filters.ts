import { INVOICE_SOURCE_LABELS } from "@/lib/invoicing";
import { legalEntityLabels, invoiceDocumentStatusLabels } from "@/lib/zod-schemas";

type SearchParameters = Record<string, string | string[] | undefined>;

function ownKey(value: string | string[] | undefined, choices: Record<string, string>) {
  return typeof value === "string" && Object.hasOwn(choices, value) ? value : undefined;
}

export function parseInvoiceFilters(params: SearchParameters, currentYear: number) {
  const { smer, zdroj, stav, subjekt, q, uhrada, rok, typ, rozsah, strana } = params;
  return {
    smer: smer === "VYDANA" || smer === "PRIJATA" ? smer : undefined,
    zdroj: ownKey(zdroj, INVOICE_SOURCE_LABELS),
    stav: ownKey(stav, invoiceDocumentStatusLabels),
    subjekt: subjekt === "UNASSIGNED" ? subjekt : ownKey(subjekt, legalEntityLabels),
    q: typeof q === "string" ? q.trim().slice(0, 100) || undefined : undefined,
    uhrada: uhrada === "PAID" || uhrada === "UNPAID" || uhrada === "OVERDUE" ? uhrada : undefined,
    rok: typeof rok === "string" && /^\d{4}$/.test(rok) && Number(rok) >= 2010 && Number(rok) <= currentYear + 1 ? rok : undefined,
    typ: typ === "INVOICE" || typ === "CREDIT_NOTE" ? typ : undefined,
    rozsah: rozsah === "PREHLAD" ? rozsah : undefined,
    strana: typeof strana === "string" && /^[1-9]\d{0,8}$/.test(strana) && strana !== "1" ? strana : undefined,
  };
}

export function invoiceListParams(filters: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return params;
}

export function invoiceListHref(filters: Record<string, string | undefined>) {
  const params = invoiceListParams(filters);
  return params.size ? `/financie/faktury?${params}` : "/financie/faktury";
}

export const overviewInvoiceScope = {
  currency: "EUR",
  documentStatus: "ISSUED",
  OR: [{ historicalKind: null }, { historicalKind: { not: "PROFORMA" } }],
};
