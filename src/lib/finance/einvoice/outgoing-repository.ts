import type { InvoicePdfData } from "@/lib/finance/documents/types";
import type { EFakturaMode } from "./config";
import type {
  ConnectorSendResult,
  EFakturaRecipientLookup,
} from "./efaktura-client";

export type OutgoingEInvoiceStatus =
  | "PENDING"
  | "VALIDATED"
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "REJECTED"
  | "FAILED";

export interface PreparedEInvoiceInput {
  invoiceId: string;
  invoiceNumber: string;
  mode: EFakturaMode;
  receiverPeppolId: string;
  ublSha256: string;
  validationIdempotencyKey: string;
  sendIdempotencyKey: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  storageProvider: string;
  bucket: string;
  actorId: string;
}

export interface PreparedEInvoiceRecord {
  id: string;
  status: OutgoingEInvoiceStatus;
  ublDocumentId: string;
  receiverPeppolId: string;
  ublSha256: string;
  validationIdempotencyKey: string;
  sendIdempotencyKey: string;
  validationResult?: unknown;
  lastError?: string;
}

export interface EInvoiceValidationRecordInput {
  transmissionId: string;
  accepted: boolean;
  connector: ConnectorSendResult;
  recipient: EFakturaRecipientLookup;
  checkedAt: Date;
}

export interface OutgoingEInvoiceRepository {
  getInvoiceData(invoiceId: string): Promise<InvoicePdfData | null>;
  savePrepared(input: PreparedEInvoiceInput): Promise<PreparedEInvoiceRecord>;
  recordValidation(
    input: EInvoiceValidationRecordInput,
  ): Promise<PreparedEInvoiceRecord>;
  recordAttemptError(
    transmissionId: string,
    error: string,
    checkedAt: Date,
  ): Promise<void>;
}
