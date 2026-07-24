export type OmegaInvoiceDirection = "VYDANA" | "PRIJATA";

export interface OmegaImportWarning {
  code: string;
  message: string;
  row?: number;
  invoiceNumber?: string;
  rawValue?: string;
}

export interface OmegaPartner {
  name: string;
  ico?: string;
  dic?: string;
  icDph?: string;
  phone?: string;
  street?: string;
  city?: string;
  zip?: string;
  country: string;
  rawRow: string[];
}

export interface OmegaInvoiceItem {
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  vatRate: number;
  totalNetCents: number;
  totalVatCents: number;
  totalGrossCents: number;
  rawRow: string[];
}

export interface OmegaInvoice {
  direction: OmegaInvoiceDirection;
  omegaNumber: string;
  externalId: string;
  externalNumber: string;
  invoiceNumber: string;
  partner: OmegaPartner;
  rawPartnerIco?: string;
  issueDate: Date;
  dueDate: Date;
  deliveryDate: Date;
  paidAt?: Date;
  currency: "EUR";
  variableSymbol?: string;
  note?: string;
  totalNetCents: number;
  totalVatCents: number;
  totalGrossCents: number;
  items: OmegaInvoiceItem[];
  rawRow: string[];
}

export interface OmegaImportSummary {
  partnerCount: number;
  invoiceCount: number;
  issuedInvoiceCount: number;
  receivedInvoiceCount: number;
  itemCount: number;
  issuedGrossCents: number;
  receivedGrossCents: number;
  totalGrossCents: number;
  highestIssuedNumber: string | null;
  nextIssuedNumber: string | null;
  warningCount: number;
  errorCount: number;
}

export interface ParsedOmegaExport {
  partners: OmegaPartner[];
  invoices: OmegaInvoice[];
  warnings: OmegaImportWarning[];
  errors: string[];
  summary: OmegaImportSummary;
}

export interface DecodedOmegaExport {
  entryName: string;
  text: string;
}
