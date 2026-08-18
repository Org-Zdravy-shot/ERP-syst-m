import type {
  AuthorizedDocumentDownload,
  DocumentService,
  StoreInvoiceAttachmentInput,
  StoredDocument,
} from "../contracts";
import {
  DocumentConfigurationError,
  DocumentIntegrityError,
  DocumentNotFoundError,
  DocumentUploadError,
} from "./errors";
import { hashesEqual, sha256 } from "./hash";
import type {
  DocumentObjectStorage,
  DocumentRepository,
  InvoicePdfRenderer,
} from "./types";

const PDF_CONTENT_TYPE = "application/pdf";
export const MAX_INVOICE_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ATTACHMENT_TYPES = [
  {
    contentType: "application/pdf",
    extension: ".pdf",
    matches: (bytes: Uint8Array) =>
      bytes.length >= 5 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x2d,
  },
  {
    contentType: "image/jpeg",
    extension: ".jpg",
    matches: (bytes: Uint8Array) =>
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff,
  },
  {
    contentType: "image/png",
    extension: ".png",
    matches: (bytes: Uint8Array) =>
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a,
  },
] as const;

function safeInvoiceNumber(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "doklad";
}

function safeAttachmentFileName(value: string, extension: string): string {
  const originalBaseName = value.replace(/\\/g, "/").split("/").pop() ?? "";
  const withoutExtension = originalBaseName.replace(/\.[^.]*$/, "");
  const safeBaseName = withoutExtension
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 160)
    .replace(/[.\s]+$/g, "");
  return `${safeBaseName || "priloha"}${extension}`;
}

function detectAttachmentType(bytes: Uint8Array) {
  return ATTACHMENT_TYPES.find((type) => type.matches(bytes));
}

export class DefaultDocumentService implements DocumentService {
  constructor(
    private readonly repository: DocumentRepository,
    private readonly storage: DocumentObjectStorage,
    private readonly renderer: InvoicePdfRenderer,
  ) {}

  private assertStorageMatches(document: {
    storageProvider: string;
    bucket: string;
  }): void {
    if (
      document.storageProvider !== this.storage.provider ||
      document.bucket !== this.storage.bucket
    ) {
      throw new DocumentConfigurationError(
        "Dokument patrí do iného úložiska, než je aktuálne nakonfigurované.",
      );
    }
  }

  async generateAndStoreInvoicePdf(invoiceId: string): Promise<StoredDocument> {
    const data = await this.repository.getInvoicePdfData(invoiceId);
    if (!data) throw new DocumentNotFoundError("Faktúra sa nenašla.");

    const bytes = await this.renderer.render(data);
    const checksum = sha256(bytes);
    const type =
      data.documentType === "CREDIT_NOTE" ? "CREDIT_NOTE_PDF" : "INVOICE_PDF";
    const prefix = data.documentType === "CREDIT_NOTE" ? "dobropis" : "faktura";
    const fileName = `${prefix}-${safeInvoiceNumber(data.invoiceNumber)}.pdf`;
    const objectKey = `finance/invoices/${data.id}/${checksum}.pdf`;

    await this.storage.putImmutable({
      objectKey,
      contentType: PDF_CONTENT_TYPE,
      bytes,
      sha256: checksum,
    });

    return this.repository.saveGeneratedDocument({
      invoiceId: data.id,
      type,
      storageProvider: this.storage.provider,
      bucket: this.storage.bucket,
      objectKey,
      fileName,
      contentType: PDF_CONTENT_TYPE,
      byteSize: bytes.byteLength,
      sha256: checksum,
    });
  }

  async storeInvoiceAttachment(
    input: StoreInvoiceAttachmentInput,
  ): Promise<StoredDocument> {
    if (input.bytes.byteLength === 0) {
      throw new DocumentUploadError("Príloha je prázdna.");
    }
    if (input.bytes.byteLength > MAX_INVOICE_ATTACHMENT_BYTES) {
      throw new DocumentUploadError("Príloha môže mať najviac 10 MB.", 413);
    }

    const attachmentType = detectAttachmentType(input.bytes);
    if (!attachmentType) {
      throw new DocumentUploadError(
        "Povolené prílohy sú iba PDF, JPG a PNG.",
        415,
      );
    }

    const invoice = await this.repository.getInvoiceAttachmentTarget(
      input.invoiceId,
    );
    if (!invoice) throw new DocumentNotFoundError("Faktúra sa nenašla.");
    if (invoice.direction !== "PRIJATA") {
      throw new DocumentUploadError(
        "Všeobecné prílohy je možné nahrávať iba k prijatým faktúram.",
        422,
      );
    }

    const checksum = sha256(input.bytes);
    const fileName = safeAttachmentFileName(
      input.fileName,
      attachmentType.extension,
    );
    const objectKey = `finance/invoices/${invoice.id}/attachments/${checksum}`;

    await this.storage.putImmutable({
      objectKey,
      contentType: attachmentType.contentType,
      bytes: input.bytes,
      sha256: checksum,
    });

    return this.repository.saveUploadedAttachment({
      invoiceId: invoice.id,
      type: "ATTACHMENT",
      storageProvider: this.storage.provider,
      bucket: this.storage.bucket,
      objectKey,
      fileName,
      contentType: attachmentType.contentType,
      byteSize: input.bytes.byteLength,
      sha256: checksum,
      createdById: input.actorId,
      actorId: input.actorId,
      actorEmail: input.actorEmail,
    });
  }

  async verifyHash(documentId: string): Promise<boolean> {
    const document = await this.repository.getDocument(documentId);
    if (!document || document.archivedAt) return false;
    this.assertStorageMatches(document);
    const object = await this.storage.getObject(document.objectKey);
    const actualHash = sha256(object.bytes);
    return (
      object.byteSize === document.byteSize &&
      hashesEqual(actualHash, document.sha256) &&
      (!object.sha256 || hashesEqual(object.sha256, document.sha256))
    );
  }

  async getAuthorizedDownload(
    documentId: string,
    actorId: string,
  ): Promise<AuthorizedDocumentDownload> {
    const document = await this.repository.getDocument(documentId);
    if (!document || document.archivedAt) throw new DocumentNotFoundError();
    this.assertStorageMatches(document);
    if (!document.isImmutable) {
      throw new DocumentIntegrityError("Dokument nie je označený ako nemenný.");
    }

    const object = await this.storage.getObject(document.objectKey);
    const actualHash = sha256(object.bytes);
    if (
      object.byteSize !== document.byteSize ||
      !hashesEqual(actualHash, document.sha256) ||
      (object.sha256 && !hashesEqual(object.sha256, document.sha256))
    ) {
      throw new DocumentIntegrityError();
    }

    await this.repository.recordAuthorizedDownload({ document, actorId });
    const responseBytes = Uint8Array.from(object.bytes);

    return {
      fileName: document.fileName,
      contentType: document.contentType,
      contentLength: responseBytes.byteLength,
      body: new Blob([responseBytes]).stream(),
    };
  }
}
