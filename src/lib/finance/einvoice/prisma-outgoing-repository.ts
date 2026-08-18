import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DocumentIntegrityError } from "@/lib/finance/documents/errors";
import { PrismaDocumentRepository } from "@/lib/finance/documents/prisma-repository";
import type {
  EInvoiceValidationRecordInput,
  OutgoingEInvoiceRepository,
  PreparedEInvoiceInput,
  PreparedEInvoiceRecord,
} from "./outgoing-repository";

const documentRepository = new PrismaDocumentRepository();

function databaseMode(mode: PreparedEInvoiceInput["mode"]): "SANDBOX" | "PRODUCTION" {
  return mode === "sandbox" ? "SANDBOX" : "PRODUCTION";
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function record(value: {
  id: string;
  status: string;
  ublDocumentId: string;
  receiverPeppolId: string;
  ublSha256: string;
  validationIdempotencyKey: string;
  sendIdempotencyKey: string;
  validationResult: Prisma.JsonValue | null;
  lastError: string | null;
}): PreparedEInvoiceRecord {
  const allowed = new Set([
    "PENDING",
    "VALIDATED",
    "QUEUED",
    "SENT",
    "DELIVERED",
    "REJECTED",
    "FAILED",
  ]);
  if (!allowed.has(value.status)) {
    throw new DocumentIntegrityError("Prenos eFaktúry má neznámy stav.");
  }
  return {
    id: value.id,
    status: value.status as PreparedEInvoiceRecord["status"],
    ublDocumentId: value.ublDocumentId,
    receiverPeppolId: value.receiverPeppolId,
    ublSha256: value.ublSha256,
    validationIdempotencyKey: value.validationIdempotencyKey,
    sendIdempotencyKey: value.sendIdempotencyKey,
    validationResult: value.validationResult ?? undefined,
    lastError: value.lastError ?? undefined,
  };
}

const transmissionSelect = {
  id: true,
  status: true,
  ublDocumentId: true,
  receiverPeppolId: true,
  ublSha256: true,
  validationIdempotencyKey: true,
  sendIdempotencyKey: true,
  validationResult: true,
  lastError: true,
} as const;

export class PrismaOutgoingEInvoiceRepository
  implements OutgoingEInvoiceRepository
{
  getInvoiceData(invoiceId: string) {
    return documentRepository.getInvoicePdfData(invoiceId);
  }

  async savePrepared(input: PreparedEInvoiceInput) {
    const mode = databaseMode(input.mode);
    const saved = await prisma.$transaction(async (tx) => {
      const unique = {
        invoiceId: input.invoiceId,
        provider: "EFAKTURA",
        mode,
        ublSha256: input.ublSha256,
      };
      const existing = await tx.eInvoiceTransmission.findUnique({
        where: { invoiceId_provider_mode_ublSha256: unique },
        select: transmissionSelect,
      });
      const document = await tx.documentAsset.upsert({
        where: { objectKey: input.objectKey },
        update: {},
        create: {
          invoiceId: input.invoiceId,
          type: "EINVOICE_XML",
          storageProvider: input.storageProvider,
          bucket: input.bucket,
          objectKey: input.objectKey,
          fileName: input.fileName,
          contentType: input.contentType,
          byteSize: input.byteSize,
          sha256: input.ublSha256,
          isImmutable: true,
          createdById: input.actorId,
        },
      });
      if (
        document.invoiceId !== input.invoiceId ||
        document.type !== "EINVOICE_XML" ||
        document.storageProvider !== input.storageProvider ||
        document.bucket !== input.bucket ||
        document.sha256 !== input.ublSha256 ||
        document.byteSize !== input.byteSize ||
        document.contentType !== input.contentType ||
        !document.isImmutable
      ) {
        throw new DocumentIntegrityError(
          "Existujúci UBL dokument nezodpovedá pripravenej eFaktúre.",
        );
      }

      const transmission = await tx.eInvoiceTransmission.upsert({
        where: { invoiceId_provider_mode_ublSha256: unique },
        update: {},
        create: {
          ...unique,
          ublDocumentId: document.id,
          status: "PENDING",
          receiverPeppolId: input.receiverPeppolId,
          validationIdempotencyKey: input.validationIdempotencyKey,
          sendIdempotencyKey: input.sendIdempotencyKey,
          createdById: input.actorId,
        },
        select: transmissionSelect,
      });
      if (
        transmission.ublDocumentId !== document.id ||
        transmission.receiverPeppolId !== input.receiverPeppolId ||
        transmission.validationIdempotencyKey !==
          input.validationIdempotencyKey ||
        transmission.sendIdempotencyKey !== input.sendIdempotencyKey
      ) {
        throw new DocumentIntegrityError(
          "Existujúca evidencia prenosu nezodpovedá nemennému UBL.",
        );
      }

      if (!existing) {
        await tx.auditLog.create({
          data: {
            actorId: input.actorId,
            action: "EINVOICE_UBL_PREPARED",
            entityType: "EInvoiceTransmission",
            entityId: transmission.id,
            metadata: {
              invoiceId: input.invoiceId,
              invoiceNumber: input.invoiceNumber,
              mode,
              receiverPeppolId: input.receiverPeppolId,
              ublSha256: input.ublSha256,
              ublDocumentId: document.id,
            },
          },
        });
      }
      return transmission;
    });

    return record(saved);
  }

  async recordValidation(input: EInvoiceValidationRecordInput) {
    const status = input.accepted ? "VALIDATED" : "REJECTED";
    const lastError = input.accepted
      ? null
      : input.connector.reason ?? "UBL neprešlo validáciou poskytovateľa.";
    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.eInvoiceTransmission.updateMany({
        where: { id: input.transmissionId, status: "PENDING" },
        data: {
          status,
          providerInvoiceId: input.connector.providerInvoiceId,
          providerDocumentId: input.connector.providerDocumentId,
          providerJobId: input.connector.jobId,
          providerState: input.connector.status,
          validationResult: jsonValue({
            recipient: input.recipient,
            connector: input.connector,
          }),
          lastError,
          validatedAt: input.checkedAt,
          lastStatusAt: input.checkedAt,
        },
      });
      const transmission = await tx.eInvoiceTransmission.findUniqueOrThrow({
        where: { id: input.transmissionId },
        select: transmissionSelect,
      });
      // Webhook mohol počas API volania posunúť stav ďalej. Taký stav nikdy
      // nevraciame späť na VALIDATED/REJECTED a nevytvárame zavádzajúci audit.
      if (updated.count === 1) {
        await tx.auditLog.create({
          data: {
            action: input.accepted
              ? "EINVOICE_UBL_VALIDATED"
              : "EINVOICE_UBL_REJECTED",
            entityType: "EInvoiceTransmission",
            entityId: transmission.id,
            metadata: {
              status,
              receiverPeppolId: transmission.receiverPeppolId,
              ublSha256: transmission.ublSha256,
              recipientFound: input.recipient.found,
              lookupUnavailable: input.recipient.lookupUnavailable,
              validation: input.connector.validation
                ? jsonValue(input.connector.validation)
                : null,
              reason: input.connector.reason ?? null,
            },
          },
        });
      }
      return transmission;
    });
    return record(saved);
  }

  async recordAttemptError(
    transmissionId: string,
    error: string,
    checkedAt: Date,
  ): Promise<void> {
    await prisma.eInvoiceTransmission.updateMany({
      where: { id: transmissionId, status: "PENDING" },
      data: {
        lastError: error.slice(0, 2_000),
        lastStatusAt: checkedAt,
      },
    });
  }
}
