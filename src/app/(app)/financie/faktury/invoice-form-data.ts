import type { Invoice, InvoiceItem } from "@prisma/client";
import { parseFmcgLine, type FmcgLineMetadata } from "@/lib/finance/einvoice/fmcg";
import { slovakDateKey } from "../../objednavky/pricing";

export interface InvoiceFormLine {
  productId?: string; productSku?: string;
  description: string; quantity: string; unit: string; unitPrice: string; vatRate: string;
  taxCategory?: "STANDARD" | "EXEMPT";
  fmcg?: FmcgLineMetadata;
}
export interface InvoiceFormInitial {
  legalEntity: string; clientId: string; issueDate: string; dueDate: string; deliveryDate: string;
  variableSymbol: string; externalNumber: string; buyerReference: string; note: string;
  lines: InvoiceFormLine[];
  expectedUpdatedAt?: string;
}
type Source = Pick<Invoice, "source" | "direction" | "documentType" | "documentStatus" | "invoiceNumber" | "finalizedAt" | "orderId" | "currency">;
export function canEditManualDraft(invoice: Source): boolean {
  return invoice.source === "INTERNA" && invoice.direction === "VYDANA" && invoice.documentType === "INVOICE" && invoice.documentStatus === "DRAFT" && !invoice.invoiceNumber && !invoice.finalizedAt && !invoice.orderId && invoice.currency === "EUR";
}
export function canCopyInvoice(invoice: Source): boolean {
  return invoice.direction === "VYDANA" && invoice.documentType === "INVOICE" && invoice.source !== "HISTORICAL" && invoice.currency === "EUR";
}
export function invoiceFormInitial(invoice: Invoice & { items: InvoiceItem[] }, mode: "edit" | "copy", now = new Date()): InvoiceFormInitial {
  const copy = mode === "copy";
  const today = slovakDateKey(now);
  const due = new Date(`${today}T12:00:00.000Z`);
  due.setUTCDate(due.getUTCDate() + 14);
  return {
    legalEntity: invoice.legalEntity ?? "", clientId: invoice.clientId ?? "",
    issueDate: copy ? today : invoice.issueDate.toISOString().slice(0, 10),
    dueDate: copy ? due.toISOString().slice(0, 10) : invoice.dueDate.toISOString().slice(0, 10),
    deliveryDate: copy ? today : (invoice.deliveryDate ?? invoice.issueDate).toISOString().slice(0, 10),
    variableSymbol: copy ? "" : invoice.variableSymbol ?? "", externalNumber: copy ? "" : invoice.externalNumber ?? "",
    buyerReference: copy ? "" : invoice.buyerReference ?? "", note: invoice.note ?? "",
    ...(copy ? {} : { expectedUpdatedAt: invoice.updatedAt.toISOString() }),
    lines: invoice.items.map((item) => {
      const snapshot = item.fmcgSnapshot ? parseFmcgLine(item.fmcgSnapshot, item.lineNumber) : undefined;
      // A new delivery must not inherit previous references, dates, lots or fees.
      const fmcg = copy && snapshot ? {
        ...(snapshot.gtin ? { gtin: snapshot.gtin } : {}),
        properties: {
          ...(snapshot.properties.item_type ? { item_type: snapshot.properties.item_type } : {}),
          ...(snapshot.properties.units_per_carton ? { units_per_carton: snapshot.properties.units_per_carton } : {}),
        },
      } : snapshot;
      return {
        productId: item.productId ?? undefined, productSku: item.productSku ?? undefined,
        description: item.description, quantity: String(item.quantity), unit: item.unit,
        unitPrice: item.unitPriceExact?.toString() ?? `${item.unitPriceCents < 0 ? "-" : ""}${Math.trunc(Math.abs(item.unitPriceCents) / 100)}.${String(Math.abs(item.unitPriceCents % 100)).padStart(2, "0")}`,
        vatRate: String(item.vatRate), taxCategory: item.taxCategory === "EXEMPT" ? "EXEMPT" : "STANDARD",
        ...(fmcg && (fmcg.gtin || Object.keys(fmcg.properties).length) ? { fmcg } : {}),
      };
    }),
  };
}
