/**
 * Spoločné kontrakty Financie v2.
 *
 * Provider implementácie developerov B a C nesmú importovať Prisma modely.
 * Doménová vrstva mapuje databázové záznamy na tieto stabilné typy.
 */

export type Currency = "EUR";
export type InvoiceDirection = "VYDANA" | "PRIJATA";
export type InvoiceDocumentType = "INVOICE" | "CREDIT_NOTE";
export type InvoiceDocumentStatus = "DRAFT" | "ISSUED" | "CANCELLED";
export type InvoicePaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "OVERPAID";
export type InvoiceSource = "INTERNA" | "WEB" | "SUPERFAKTURA" | "OMEGA";

export interface PartySnapshot {
  name: string;
  ico?: string;
  dic?: string;
  icDph?: string;
  email?: string;
  phone?: string;
  street?: string;
  city?: string;
  zip?: string;
  country: string;
  iban?: string;
  bic?: string;
}

export interface TaxSnapshot {
  vatStatus: "NON_PAYER" | "PAYER";
  vatRegisteredFrom?: Date;
  domesticTaxMode: "STANDARD" | "EXEMPT";
  deliveryDate: Date;
}

export interface InvoiceLineInput {
  productId?: string;
  description: string;
  productSku?: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  vatRate: number;
  taxCategory?: "STANDARD" | "EXEMPT";
}

export interface InvoiceLineCalculation extends InvoiceLineInput {
  lineNumber: number;
  totalNetCents: number;
  totalVatCents: number;
  totalGrossCents: number;
}

export interface CalculateInvoiceInput {
  currency: Currency;
  lines: InvoiceLineInput[];
}

export interface InvoiceCalculation {
  currency: Currency;
  lines: InvoiceLineCalculation[];
  totalNetCents: number;
  totalVatCents: number;
  totalGrossCents: number;
}

export interface CreateInvoiceDraftInput {
  direction: InvoiceDirection;
  documentType?: InvoiceDocumentType;
  source?: InvoiceSource;
  externalId?: string;
  externalNumber?: string;
  clientId?: string;
  counterparty?: PartySnapshot;
  orderId?: string;
  originalInvoiceId?: string;
  issueDate: Date;
  dueDate: Date;
  deliveryDate?: Date;
  currency: Currency;
  variableSymbol?: string;
  note?: string;
  items: InvoiceLineInput[];
  actorId: string;
}

export interface InvoiceResult {
  id: string;
  invoiceNumber: string | null;
  direction: InvoiceDirection;
  documentType: InvoiceDocumentType;
  documentStatus: InvoiceDocumentStatus;
  paymentStatus: InvoicePaymentStatus;
  calculation: InvoiceCalculation;
}

export interface FinalizedInvoice extends InvoiceResult {
  invoiceNumber: string;
  documentStatus: "ISSUED";
  finalizedAt: Date;
  issuerSnapshot: PartySnapshot;
  counterpartySnapshot: PartySnapshot;
  taxSnapshot: TaxSnapshot;
  outboxEventIds: string[];
}

export interface CreateCreditNoteInput {
  originalInvoiceId: string;
  issueDate: Date;
  dueDate: Date;
  deliveryDate: Date;
  reason: string;
  items?: InvoiceLineInput[];
  actorId: string;
}

export interface AccountingExportInput {
  direction?: InvoiceDirection;
  dateFrom?: Date;
  dateTo?: Date;
  source?: InvoiceSource;
  includeCancelled?: boolean;
}

export interface AccountingExport {
  fileName: string;
  contentType: string;
  content: Uint8Array;
  invoiceCount: number;
  totalGrossCents: number;
  sha256: string;
}

export interface InvoiceService {
  createDraft(input: CreateInvoiceDraftInput): Promise<InvoiceResult>;
  calculate(input: CalculateInvoiceInput): InvoiceCalculation;
  finalize(invoiceId: string, actorId: string): Promise<FinalizedInvoice>;
  createCreditNote(input: CreateCreditNoteInput): Promise<InvoiceResult>;
  exportAccounting(input: AccountingExportInput): Promise<AccountingExport>;
}

export type DocumentType = "INVOICE_PDF" | "CREDIT_NOTE_PDF" | "ATTACHMENT";

export interface StoredDocument {
  id: string;
  invoiceId?: string;
  type: DocumentType;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  objectKey: string;
  createdAt: Date;
}

export interface AuthorizedDocumentDownload {
  fileName: string;
  contentType: string;
  contentLength: number;
  body: ReadableStream<Uint8Array>;
}

export interface DocumentService {
  generateAndStoreInvoicePdf(invoiceId: string): Promise<StoredDocument>;
  verifyHash(documentId: string): Promise<boolean>;
  getAuthorizedDownload(documentId: string, actorId: string): Promise<AuthorizedDocumentDownload>;
}

export interface MailMessage {
  idempotencyKey: string;
  invoiceId: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  documentIds: string[];
  replyTo?: string;
}

export interface MailResult {
  providerMessageId: string;
  acceptedRecipients: string[];
  rejectedRecipients: string[];
  submittedAt: Date;
}

export type MailDeliveryStatus = "PENDING" | "SENT" | "DELIVERED" | "FAILED" | "BOUNCED";

export interface MailProvider {
  readonly providerName: string;
  send(message: MailMessage): Promise<MailResult>;
  getDeliveryStatus(providerMessageId: string): Promise<MailDeliveryStatus>;
}

export interface BankAccountResult {
  providerAccountId: string;
  name: string;
  iban: string;
  bic?: string;
  currency: Currency;
}

export interface BankBalanceResult {
  providerAccountId: string;
  availableCents: number;
  bookedCents: number;
  currency: Currency;
  measuredAt: Date;
}

export interface BankTransactionResult {
  providerTransactionId: string;
  providerAccountId: string;
  status: "PENDING" | "BOOKED";
  bookingDate: Date;
  valueDate?: Date;
  amountCents: number;
  currency: Currency;
  counterpartyName?: string;
  counterpartyIban?: string;
  variableSymbol?: string;
  constantSymbol?: string;
  specificSymbol?: string;
  remittanceInfo?: string;
  rawPayload?: unknown;
}

export interface BankSyncPage {
  transactions: BankTransactionResult[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface BankProvider {
  listAccounts(): Promise<BankAccountResult[]>;
  getBalances(): Promise<BankBalanceResult[]>;
  syncTransactions(cursor?: string): Promise<BankSyncPage>;
  reconnect(): Promise<void>;
}

export type EInvoiceStatus = "QUEUED" | "SENT" | "DELIVERED" | "REJECTED" | "FAILED";

export interface EInvoiceResult {
  providerDocumentId: string;
  status: EInvoiceStatus;
  submittedAt: Date;
}

export interface ReceivedEInvoice {
  providerDocumentId: string;
  receivedAt: Date;
  contentType: string;
  content: Uint8Array;
}

export interface EInvoicePage {
  documents: ReceivedEInvoice[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface EInvoiceProvider {
  send(invoiceId: string): Promise<EInvoiceResult>;
  receive(cursor?: string): Promise<EInvoicePage>;
  getStatus(providerDocumentId: string): Promise<EInvoiceStatus>;
}
