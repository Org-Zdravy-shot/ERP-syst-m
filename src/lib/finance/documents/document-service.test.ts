import { expect, test } from "vitest";
import type { StoredDocument } from "../contracts";
import { DefaultDocumentService } from "./document-service";
import { DocumentIntegrityError } from "./errors";
import { sha256 } from "./hash";
import { MemoryDocumentStorage } from "./storage";
import { createInvoicePdfFixture } from "./test-fixtures";
import type {
  DocumentRecord,
  DocumentRepository,
  GeneratedDocumentInput,
  InvoiceAttachmentTarget,
  InvoicePdfData,
  InvoicePdfRenderer,
  UploadedAttachmentInput,
} from "./types";

class FixedRenderer implements InvoicePdfRenderer {
  readonly bytes = new TextEncoder().encode("%PDF-test-document");

  async render(): Promise<Uint8Array> {
    return Uint8Array.from(this.bytes);
  }
}

class FakeDocumentRepository implements DocumentRepository {
  readonly audits: Array<{ documentId: string; actorId: string }> = [];
  readonly uploadedInputs: UploadedAttachmentInput[] = [];
  document?: DocumentRecord;

  constructor(
    private readonly invoice: InvoicePdfData | null,
    readonly attachmentTarget: InvoiceAttachmentTarget | null = {
      id: "invoice-test-1",
      direction: "PRIJATA",
    },
  ) {}

  async getInvoicePdfData(): Promise<InvoicePdfData | null> {
    return this.invoice;
  }

  async getInvoiceAttachmentTarget(): Promise<InvoiceAttachmentTarget | null> {
    return this.attachmentTarget;
  }

  async saveGeneratedDocument(input: GeneratedDocumentInput): Promise<StoredDocument> {
    this.document ??= {
      id: "document-test-1",
      invoiceId: input.invoiceId,
      type: input.type,
      storageProvider: input.storageProvider,
      bucket: input.bucket,
      objectKey: input.objectKey,
      fileName: input.fileName,
      contentType: input.contentType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      isImmutable: true,
      createdAt: new Date("2026-07-24T12:00:00.000Z"),
    };
    return this.document;
  }

  async saveUploadedAttachment(input: UploadedAttachmentInput): Promise<StoredDocument> {
    this.uploadedInputs.push(input);
    return this.saveGeneratedDocument(input);
  }

  async getDocument(): Promise<DocumentRecord | null> {
    return this.document ?? null;
  }

  async recordAuthorizedDownload(input: {
    document: DocumentRecord;
    actorId: string;
  }): Promise<void> {
    this.audits.push({
      documentId: input.document.id,
      actorId: input.actorId,
    });
  }
}

test("služba uloží obsahovo adresovaný nemenný dokument idempotentne", async () => {
  const repository = new FakeDocumentRepository(createInvoicePdfFixture());
  const storage = new MemoryDocumentStorage();
  const renderer = new FixedRenderer();
  const service = new DefaultDocumentService(repository, storage, renderer);

  const first = await service.generateAndStoreInvoicePdf("invoice-test-1");
  const second = await service.generateAndStoreInvoicePdf("invoice-test-1");
  const expectedHash = sha256(renderer.bytes);

  expect(first.id).toBe(second.id);
  expect(first.sha256).toBe(expectedHash);
  expect(first.objectKey).toBe(
    `finance/invoices/invoice-test-1/${expectedHash}.pdf`,
  );
  expect(await service.verifyHash(first.id)).toBe(true);
});

test("autorizovaný download overí hash a vytvorí audit", async () => {
  const repository = new FakeDocumentRepository(createInvoicePdfFixture());
  const storage = new MemoryDocumentStorage();
  const renderer = new FixedRenderer();
  const service = new DefaultDocumentService(repository, storage, renderer);
  const document = await service.generateAndStoreInvoicePdf("invoice-test-1");

  const download = await service.getAuthorizedDownload(
    document.id,
    "finance-admin-1",
  );
  const bytes = new Uint8Array(await new Response(download.body).arrayBuffer());

  expect(bytes).toEqual(renderer.bytes);
  expect(repository.audits).toEqual([
    { documentId: document.id, actorId: "finance-admin-1" },
  ]);

  storage.overwriteForTest(document.objectKey, new TextEncoder().encode("tampered"));
  expect(await service.verifyHash(document.id)).toBe(false);
  await expect(
    service.getAuthorizedDownload(document.id, "finance-admin-1"),
  ).rejects.toBeInstanceOf(DocumentIntegrityError);
  expect(repository.audits.length).toBe(1);
});

test("download odmietne dokument z iného bucketu", async () => {
  const repository = new FakeDocumentRepository(createInvoicePdfFixture());
  const sourceStorage = new MemoryDocumentStorage();
  const renderer = new FixedRenderer();
  const sourceService = new DefaultDocumentService(
    repository,
    sourceStorage,
    renderer,
  );
  const document = await sourceService.generateAndStoreInvoicePdf("invoice-test-1");
  repository.document = { ...repository.document!, bucket: "iny-bucket" };

  await expect(
    sourceService.getAuthorizedDownload(document.id, "finance-admin-1"),
  ).rejects.toThrow(/iného úložiska/);
});

test("prílohu prijatej faktúry uloží nemenne, bezpečne pomenuje a zaeviduje aktéra", async () => {
  const repository = new FakeDocumentRepository(null);
  const storage = new MemoryDocumentStorage();
  const service = new DefaultDocumentService(
    repository,
    storage,
    new FixedRenderer(),
  );
  const bytes = new TextEncoder().encode("%PDF-1.7\ninvoice attachment");

  const document = await service.storeInvoiceAttachment({
    invoiceId: "invoice-test-1",
    actorId: "finance-operator-1",
    actorEmail: "operator@example.sk",
    fileName: "../../Dodávateľská faktúra.exe",
    contentType: "text/html",
    bytes,
  });

  const checksum = sha256(bytes);
  expect(document.type).toBe("ATTACHMENT");
  expect(document.fileName).toBe("Dodávateľská faktúra.pdf");
  expect(document.contentType).toBe("application/pdf");
  expect(document.objectKey).toBe(
    `finance/invoices/invoice-test-1/attachments/${checksum}`,
  );
  expect(repository.uploadedInputs[0]).toMatchObject({
    actorId: "finance-operator-1",
    actorEmail: "operator@example.sk",
    createdById: "finance-operator-1",
    sha256: checksum,
  });
  expect(await service.verifyHash(document.id)).toBe(true);
});

test("prílohy odmietne pri vydanej faktúre a pri falošnom type súboru", async () => {
  const outgoingRepository = new FakeDocumentRepository(null, {
    id: "invoice-test-1",
    direction: "VYDANA",
  });
  const outgoingService = new DefaultDocumentService(
    outgoingRepository,
    new MemoryDocumentStorage(),
    new FixedRenderer(),
  );

  await expect(
    outgoingService.storeInvoiceAttachment({
      invoiceId: "invoice-test-1",
      actorId: "finance-admin-1",
      fileName: "faktura.pdf",
      bytes: new TextEncoder().encode("%PDF-1.7\ntest"),
    }),
  ).rejects.toMatchObject({ status: 422 });

  await expect(
    outgoingService.storeInvoiceAttachment({
      invoiceId: "invoice-test-1",
      actorId: "finance-admin-1",
      fileName: "faktura.pdf",
      bytes: new TextEncoder().encode("<html>not a pdf</html>"),
    }),
  ).rejects.toMatchObject({ status: 415 });
});
