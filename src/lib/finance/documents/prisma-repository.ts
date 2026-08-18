import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  DocumentGenerationError,
  DocumentIntegrityError,
} from "./errors";
import type {
  DocumentRecord,
  DocumentRepository,
  GeneratedDocumentInput,
  InvoiceAttachmentTarget,
  InvoicePdfData,
  UploadedAttachmentInput,
} from "./types";

const optionalString = z.preprocess(
  (value) => (value === null || value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const partySnapshotSchema = z.object({
  name: z.string().trim().min(1),
  ico: optionalString,
  dic: optionalString,
  icDph: optionalString,
  email: optionalString,
  phone: optionalString,
  street: optionalString,
  city: optionalString,
  zip: optionalString,
  country: z.string().trim().min(2),
  iban: optionalString,
  bic: optionalString,
});

const optionalDate = z.preprocess(
  (value) => (value === null || value === "" ? undefined : value),
  z.coerce.date().optional(),
);

const taxSnapshotSchema = z.object({
  vatStatus: z.enum(["NON_PAYER", "PAYER"]),
  vatRegisteredFrom: optionalDate,
  domesticTaxMode: z.enum(["STANDARD", "EXEMPT"]),
  deliveryDate: z.coerce.date(),
});

function toDocumentRecord(
  document: {
    id: string;
    invoiceId: string | null;
    type: string;
    storageProvider: string;
    bucket: string;
    objectKey: string;
    fileName: string;
    contentType: string;
    byteSize: number;
    sha256: string;
    isImmutable: boolean;
    createdAt: Date;
    archivedAt: Date | null;
  },
): DocumentRecord {
  if (
    document.type !== "INVOICE_PDF" &&
    document.type !== "CREDIT_NOTE_PDF" &&
    document.type !== "ATTACHMENT" &&
    document.type !== "EINVOICE_XML" &&
    document.type !== "RECEIVED_EINVOICE_XML"
  ) {
    throw new DocumentIntegrityError("Dokument má neznámy typ.");
  }

  return {
    id: document.id,
    invoiceId: document.invoiceId ?? undefined,
    type: document.type,
    storageProvider: document.storageProvider,
    bucket: document.bucket,
    objectKey: document.objectKey,
    fileName: document.fileName,
    contentType: document.contentType,
    byteSize: document.byteSize,
    sha256: document.sha256,
    isImmutable: document.isImmutable,
    createdAt: document.createdAt,
    archivedAt: document.archivedAt ?? undefined,
  };
}

export class PrismaDocumentRepository implements DocumentRepository {
  async getInvoicePdfData(invoiceId: string): Promise<InvoicePdfData | null> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        direction: true,
        documentType: true,
        documentStatus: true,
        invoiceNumber: true,
        currency: true,
        issueDate: true,
        dueDate: true,
        finalizedAt: true,
        variableSymbol: true,
        note: true,
        issuerSnapshot: true,
        counterpartySnapshot: true,
        taxSnapshot: true,
        totalNetCents: true,
        totalVatCents: true,
        totalGrossCents: true,
        originalInvoice: { select: { invoiceNumber: true } },
        items: {
          orderBy: { lineNumber: "asc" },
          select: {
            productId: true,
            productSku: true,
            lineNumber: true,
            description: true,
            quantity: true,
            unit: true,
            unitPriceCents: true,
            vatRate: true,
            totalNetCents: true,
            totalVatCents: true,
            totalGrossCents: true,
            taxCategory: true,
          },
        },
      },
    });
    if (!invoice) return null;
    if (invoice.direction !== "VYDANA") {
      throw new DocumentGenerationError(
        "PDF je možné generovať iba pre vydanú faktúru alebo dobropis.",
      );
    }
    if (invoice.documentStatus !== "ISSUED") {
      throw new DocumentGenerationError(
        "PDF je možné generovať až po finalizácii dokladu.",
      );
    }
    if (!invoice.invoiceNumber || !invoice.finalizedAt) {
      throw new DocumentGenerationError(
        "Finalizovanému dokladu chýba číslo alebo čas finalizácie.",
      );
    }
    if (invoice.currency !== "EUR") {
      throw new DocumentGenerationError("PDF v prvej etape podporuje iba menu EUR.");
    }
    if (
      invoice.documentType !== "INVOICE" &&
      invoice.documentType !== "CREDIT_NOTE"
    ) {
      throw new DocumentGenerationError("Doklad má nepodporovaný typ.");
    }

    const issuer = partySnapshotSchema.safeParse(invoice.issuerSnapshot);
    const counterparty = partySnapshotSchema.safeParse(
      invoice.counterpartySnapshot,
    );
    const tax = taxSnapshotSchema.safeParse(invoice.taxSnapshot);
    if (!issuer.success || !counterparty.success || !tax.success) {
      throw new DocumentGenerationError(
        "Finalizovanému dokladu chýbajú platné nemenné snapshoty.",
      );
    }
    if (tax.data.vatStatus === "PAYER" && !issuer.data.icDph) {
      throw new DocumentGenerationError(
        "Snapshot platiteľa DPH neobsahuje IČ DPH dodávateľa.",
      );
    }
    if (
      invoice.documentType === "CREDIT_NOTE" &&
      !invoice.originalInvoice?.invoiceNumber
    ) {
      throw new DocumentGenerationError(
        "Dobropisu chýba číslo pôvodnej faktúry.",
      );
    }

    const lines = invoice.items.map((item) => {
      if (
        item.totalNetCents === null ||
        item.totalVatCents === null ||
        item.totalGrossCents === null
      ) {
        throw new DocumentGenerationError(
          `Položke ${item.lineNumber} chýbajú nemenné vypočítané sumy.`,
        );
      }
      if (item.taxCategory !== null && item.taxCategory !== "STANDARD" && item.taxCategory !== "EXEMPT") {
        throw new DocumentGenerationError(
          `Položka ${item.lineNumber} má neznámu daňovú kategóriu.`,
        );
      }
      if (
        item.taxCategory === "EXEMPT" &&
        (item.vatRate !== 0 || item.totalVatCents !== 0)
      ) {
        throw new DocumentGenerationError(
          `Oslobodená položka ${item.lineNumber} obsahuje DPH.`,
        );
      }
      const taxCategory: "STANDARD" | "EXEMPT" | undefined =
        item.taxCategory === "STANDARD" || item.taxCategory === "EXEMPT"
          ? item.taxCategory
          : undefined;

      return {
        productId: item.productId ?? undefined,
        productSku: item.productSku ?? undefined,
        lineNumber: item.lineNumber,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPriceCents: item.unitPriceCents,
        vatRate: item.vatRate,
        totalNetCents: item.totalNetCents,
        totalVatCents: item.totalVatCents,
        totalGrossCents: item.totalGrossCents,
        taxCategory,
      };
    });
    if (lines.length === 0) {
      throw new DocumentGenerationError("Doklad nemá žiadne položky.");
    }
    if (
      tax.data.vatStatus === "NON_PAYER" &&
      lines.some((line) => line.vatRate !== 0 || line.totalVatCents !== 0)
    ) {
      throw new DocumentGenerationError(
        "Doklad neplatiteľa DPH nesmie obsahovať vyčíslenú DPH.",
      );
    }

    const calculated = lines.reduce(
      (totals, line) => ({
        net: totals.net + line.totalNetCents,
        vat: totals.vat + line.totalVatCents,
        gross: totals.gross + line.totalGrossCents,
      }),
      { net: 0, vat: 0, gross: 0 },
    );
    if (
      calculated.net !== invoice.totalNetCents ||
      calculated.vat !== invoice.totalVatCents ||
      calculated.gross !== invoice.totalGrossCents
    ) {
      throw new DocumentGenerationError(
        "Súčet nemenných položiek nesedí s celkovou sumou dokladu.",
      );
    }

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      documentType: invoice.documentType,
      originalInvoiceNumber:
        invoice.originalInvoice?.invoiceNumber ?? undefined,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      finalizedAt: invoice.finalizedAt,
      currency: "EUR",
      variableSymbol: invoice.variableSymbol ?? undefined,
      note: invoice.note ?? undefined,
      issuer: issuer.data,
      counterparty: counterparty.data,
      tax: tax.data,
      lines,
      totalNetCents: invoice.totalNetCents,
      totalVatCents: invoice.totalVatCents,
      totalGrossCents: invoice.totalGrossCents,
    };
  }

  async getInvoiceAttachmentTarget(
    invoiceId: string,
  ): Promise<InvoiceAttachmentTarget | null> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, direction: true },
    });
    if (!invoice) return null;
    if (invoice.direction !== "VYDANA" && invoice.direction !== "PRIJATA") {
      throw new DocumentIntegrityError("Faktúra má neznámy smer.");
    }
    return { id: invoice.id, direction: invoice.direction };
  }

  async saveGeneratedDocument(input: GeneratedDocumentInput) {
    const document = await prisma.documentAsset.upsert({
      where: { objectKey: input.objectKey },
      update: {},
      create: {
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
        createdById: input.createdById,
      },
      select: {
        id: true,
        invoiceId: true,
        type: true,
        storageProvider: true,
        bucket: true,
        objectKey: true,
        fileName: true,
        contentType: true,
        byteSize: true,
        sha256: true,
        isImmutable: true,
        createdAt: true,
        archivedAt: true,
      },
    });

    const record = toDocumentRecord(document);
    if (
      record.invoiceId !== input.invoiceId ||
      record.sha256 !== input.sha256 ||
      !record.isImmutable
    ) {
      throw new DocumentIntegrityError(
        "Existujúci záznam dokumentu nezodpovedá generovanému súboru.",
      );
    }
    return record;
  }

  async saveUploadedAttachment(input: UploadedAttachmentInput) {
    const document = await prisma.$transaction(async (tx) => {
      const stored = await tx.documentAsset.upsert({
        where: { objectKey: input.objectKey },
        update: {},
        create: {
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
          createdById: input.createdById,
        },
        select: {
          id: true,
          invoiceId: true,
          type: true,
          storageProvider: true,
          bucket: true,
          objectKey: true,
          fileName: true,
          contentType: true,
          byteSize: true,
          sha256: true,
          isImmutable: true,
          createdAt: true,
          archivedAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          actorEmail: input.actorEmail,
          action: "DOCUMENT_ATTACHMENT_STORED",
          entityType: "DocumentAsset",
          entityId: stored.id,
          metadata: {
            invoiceId: input.invoiceId,
            fileName: stored.fileName,
            contentType: stored.contentType,
            byteSize: stored.byteSize,
            sha256: stored.sha256,
          },
        },
      });
      return stored;
    });

    const record = toDocumentRecord(document);
    if (
      record.invoiceId !== input.invoiceId ||
      record.type !== "ATTACHMENT" ||
      record.storageProvider !== input.storageProvider ||
      record.bucket !== input.bucket ||
      record.objectKey !== input.objectKey ||
      record.sha256 !== input.sha256 ||
      record.byteSize !== input.byteSize ||
      record.contentType !== input.contentType ||
      !record.isImmutable
    ) {
      throw new DocumentIntegrityError(
        "Existujúci záznam prílohy nezodpovedá nahranému súboru.",
      );
    }
    return record;
  }

  async getDocument(documentId: string): Promise<DocumentRecord | null> {
    const document = await prisma.documentAsset.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        invoiceId: true,
        type: true,
        storageProvider: true,
        bucket: true,
        objectKey: true,
        fileName: true,
        contentType: true,
        byteSize: true,
        sha256: true,
        isImmutable: true,
        createdAt: true,
        archivedAt: true,
      },
    });
    return document ? toDocumentRecord(document) : null;
  }

  async recordAuthorizedDownload(input: {
    document: DocumentRecord;
    actorId: string;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "DOCUMENT_DOWNLOADED",
        entityType: "DocumentAsset",
        entityId: input.document.id,
        metadata: {
          invoiceId: input.document.invoiceId,
          type: input.document.type,
          sha256: input.document.sha256,
        },
      },
    });
  }
}
