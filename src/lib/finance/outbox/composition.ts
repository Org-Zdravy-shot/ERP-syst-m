import { join } from "node:path";
import type { DocumentObjectStorage } from "@/lib/finance/documents/types";
import type { DocumentService } from "@/lib/finance/contracts";
import { DefaultDocumentService } from "@/lib/finance/documents/document-service";
import { SlovakInvoicePdfRenderer } from "@/lib/finance/documents/pdf-renderer";
import { PrismaDocumentRepository } from "@/lib/finance/documents/prisma-repository";
import { readS3DocumentStorageConfig, S3DocumentStorage } from "@/lib/finance/documents/storage";
import {
  DocumentConfigurationError,
  DocumentIntegrityError,
} from "@/lib/finance/documents/errors";
import { hashesEqual, sha256 } from "@/lib/finance/documents/hash";
import { prisma } from "@/lib/prisma";
import { SmtpMailProvider } from "@/lib/finance/mail/smtp-provider";
import { LogMailProvider } from "@/lib/finance/mail/log-provider";
import { MAIL_FROM, smtpConfigured } from "@/lib/finance/mail/config";
import type { AttachmentLoader, MailProvider, ResolvedAttachment } from "@/lib/finance/mail/types";
import { LocalFsDocumentStorage } from "./local-storage";

/** True keď je nakonfigurovaný privátny bucket (produkcia). */
function bucketConfigured(): boolean {
  return !!(process.env.DOCUMENT_BUCKET_NAME || process.env.BUCKET);
}

let storageSingleton: DocumentObjectStorage | undefined;

/**
 * Úložisko dokumentov: privátny S3/Railway Bucket v produkcii, inak lokálny
 * FS fallback (`.local-bucket/`) pre vývoj a E2E. Voľba podľa konfigurácie.
 */
export function getWorkerStorage(): DocumentObjectStorage {
  if (!storageSingleton) {
    if (bucketConfigured()) {
      storageSingleton = new S3DocumentStorage(readS3DocumentStorageConfig());
    } else if (process.env.NODE_ENV === "production") {
      throw new DocumentConfigurationError(
        "Produkčné úložisko finančných dokumentov nie je nakonfigurované.",
      );
    } else {
      storageSingleton = new LocalFsDocumentStorage(
        join(process.cwd(), ".local-bucket"),
      );
    }
  }
  return storageSingleton;
}

let documentServiceSingleton: DocumentService | undefined;

/** DocumentService pre worker — reuse Dev B renderer/repository, storage podľa prostredia. */
export function getWorkerDocumentService(): DocumentService {
  documentServiceSingleton ??= new DefaultDocumentService(
    new PrismaDocumentRepository(),
    getWorkerStorage(),
    new SlovakInvoicePdfRenderer(),
  );
  return documentServiceSingleton;
}

/**
 * Loader príloh pre e-mail: DocumentAsset → bajty zo storage.
 * Overuje SHA-256 pred priložením — nikdy nepošleme pozmenené PDF.
 */
export class StorageAttachmentLoader implements AttachmentLoader {
  constructor(private readonly storage: DocumentObjectStorage) {}

  async load(documentId: string): Promise<ResolvedAttachment> {
    const document = await prisma.documentAsset.findUnique({ where: { id: documentId } });
    if (!document || document.archivedAt) {
      throw new Error(`Dokument ${documentId} sa nenašiel alebo je archivovaný.`);
    }
    if (
      !document.isImmutable ||
      document.storageProvider !== this.storage.provider ||
      document.bucket !== this.storage.bucket
    ) {
      throw new DocumentIntegrityError(
        `Dokument ${documentId} nezodpovedá nakonfigurovanému úložisku.`,
      );
    }
    const object = await this.storage.getObject(document.objectKey);
    if (
      object.byteSize !== document.byteSize ||
      !hashesEqual(sha256(object.bytes), document.sha256) ||
      (object.sha256 && !hashesEqual(object.sha256, document.sha256))
    ) {
      throw new Error(`Integrita dokumentu ${documentId} zlyhala — PDF sa neposiela.`);
    }
    return { fileName: document.fileName, contentType: document.contentType, bytes: object.bytes };
  }
}

let mailProviderSingleton: MailProvider | undefined;

/** SMTP provider v produkcii; LogMailProvider je povolený iba v dev/teste. */
export function getMailProvider(): MailProvider {
  if (!mailProviderSingleton) {
    if (
      process.env.NODE_ENV === "production" &&
      (MAIL_FROM.toLowerCase() !== "info@zdravyshot.sk" ||
        process.env.FINANCE_MAIL_DKIM_CONFIRMED !== "true")
    ) {
      throw new Error(
        "Produkčný e-mail vyžaduje odosielateľa info@zdravyshot.sk a potvrdené DKIM.",
      );
    }
    const loader = new StorageAttachmentLoader(getWorkerStorage());
    if (smtpConfigured()) {
      mailProviderSingleton = new SmtpMailProvider(loader);
    } else if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Produkčný worker vyžaduje platnú konfiguráciu transakčného SMTP providera.",
      );
    } else {
      mailProviderSingleton = new LogMailProvider();
    }
  }
  return mailProviderSingleton;
}

export function mailSendingEnabled(): boolean {
  if (
    process.env.NODE_ENV === "production" &&
    (MAIL_FROM.toLowerCase() !== "info@zdravyshot.sk" ||
      process.env.FINANCE_MAIL_DKIM_CONFIRMED !== "true")
  ) {
    return false;
  }
  return smtpConfigured() || process.env.NODE_ENV !== "production";
}

/** Reset singletonov — pre testy. */
export function __resetCompositionForTests(): void {
  storageSingleton = undefined;
  documentServiceSingleton = undefined;
  mailProviderSingleton = undefined;
}
