import type {
  DocumentType,
  InvoiceDocumentType,
  InvoiceLineCalculation,
  PartySnapshot,
  StoredDocument,
  TaxSnapshot,
} from "../contracts";

export interface InvoicePdfData {
  id: string;
  invoiceNumber: string;
  documentType: InvoiceDocumentType;
  originalInvoiceNumber?: string;
  issueDate: Date;
  dueDate: Date;
  finalizedAt: Date;
  currency: "EUR";
  variableSymbol?: string;
  /** Číslo objednávky kupujúceho; pre Peppol BuyerReference sa nesmie vymyslieť. */
  buyerReference?: string;
  note?: string;
  issuer: PartySnapshot;
  counterparty: PartySnapshot;
  tax: TaxSnapshot;
  lines: InvoiceLineCalculation[];
  totalNetCents: number;
  totalVatCents: number;
  totalGrossCents: number;
}

export interface GeneratedDocumentInput {
  invoiceId: string;
  type: DocumentType;
  storageProvider: string;
  bucket: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  createdById?: string;
}

export interface InvoiceAttachmentTarget {
  id: string;
  direction: "VYDANA" | "PRIJATA";
}

export interface UploadedAttachmentInput
  extends Omit<GeneratedDocumentInput, "type"> {
  type: "ATTACHMENT";
  actorId: string;
  actorEmail?: string;
}

export interface DocumentRecord extends StoredDocument {
  storageProvider: string;
  bucket: string;
  isImmutable: boolean;
  archivedAt?: Date;
}

export interface DocumentRepository {
  getInvoicePdfData(invoiceId: string): Promise<InvoicePdfData | null>;
  getInvoiceAttachmentTarget(invoiceId: string): Promise<InvoiceAttachmentTarget | null>;
  saveGeneratedDocument(input: GeneratedDocumentInput): Promise<StoredDocument>;
  saveUploadedAttachment(input: UploadedAttachmentInput): Promise<StoredDocument>;
  getDocument(documentId: string): Promise<DocumentRecord | null>;
  recordAuthorizedDownload(input: {
    document: DocumentRecord;
    actorId: string;
  }): Promise<void>;
}

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
  byteSize: number;
  sha256?: string;
}

export interface PutImmutableObjectInput {
  objectKey: string;
  contentType: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface DocumentObjectStorage {
  readonly provider: string;
  readonly bucket: string;
  putImmutable(input: PutImmutableObjectInput): Promise<void>;
  getObject(objectKey: string): Promise<StoredObject>;
}

export interface InvoicePdfRenderer {
  render(data: InvoicePdfData): Promise<Uint8Array>;
}
