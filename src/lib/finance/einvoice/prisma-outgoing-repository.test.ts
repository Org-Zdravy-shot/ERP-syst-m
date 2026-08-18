import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  transmissionFindUnique: vi.fn(),
  transmissionFindUniqueOrThrow: vi.fn(),
  transmissionUpsert: vi.fn(),
  transmissionUpdateMany: vi.fn(),
  documentUpsert: vi.fn(),
  auditCreate: vi.fn(),
  invoiceData: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    eInvoiceTransmission: { updateMany: mocks.transmissionUpdateMany },
  },
}));

vi.mock("@/lib/finance/documents/prisma-repository", () => ({
  PrismaDocumentRepository: class {
    getInvoicePdfData = mocks.invoiceData;
  },
}));

import { PrismaOutgoingEInvoiceRepository } from "./prisma-outgoing-repository";

const selectedTransmission = {
  id: "transmission-1",
  status: "PENDING",
  ublDocumentId: "document-1",
  receiverPeppolId: "9915:2198765432",
  ublSha256: "hash-1",
  validationIdempotencyKey: "validate-1",
  sendIdempotencyKey: "send-1",
  validationResult: null,
  lastError: null,
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      eInvoiceTransmission: {
        findUnique: mocks.transmissionFindUnique,
        findUniqueOrThrow: mocks.transmissionFindUniqueOrThrow,
        upsert: mocks.transmissionUpsert,
        updateMany: mocks.transmissionUpdateMany,
      },
      documentAsset: { upsert: mocks.documentUpsert },
      auditLog: { create: mocks.auditCreate },
    }),
  );
});

describe("PrismaOutgoingEInvoiceRepository", () => {
  it("uloží UBL, prenos a audit v jednej transakcii", async () => {
    mocks.transmissionFindUnique.mockResolvedValue(null);
    mocks.documentUpsert.mockResolvedValue({
      id: "document-1",
      invoiceId: "invoice-1",
      type: "EINVOICE_XML",
      storageProvider: "RAILWAY_BUCKET",
      bucket: "finance-documents",
      sha256: "hash-1",
      byteSize: 1234,
      contentType: "application/xml",
      isImmutable: true,
    });
    mocks.transmissionUpsert.mockResolvedValue(selectedTransmission);

    const result = await new PrismaOutgoingEInvoiceRepository().savePrepared({
      invoiceId: "invoice-1",
      invoiceNumber: "2026009",
      mode: "sandbox",
      receiverPeppolId: "9915:2198765432",
      ublSha256: "hash-1",
      validationIdempotencyKey: "validate-1",
      sendIdempotencyKey: "send-1",
      objectKey: "finance/invoices/invoice-1/einvoice/hash-1.xml",
      fileName: "efaktura-2026009.xml",
      contentType: "application/xml",
      byteSize: 1234,
      storageProvider: "RAILWAY_BUCKET",
      bucket: "finance-documents",
      actorId: "admin-1",
    });

    expect(result.status).toBe("PENDING");
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.documentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          type: "EINVOICE_XML",
          isImmutable: true,
        }),
      }),
    );
    expect(mocks.transmissionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          invoiceId_provider_mode_ublSha256: {
            invoiceId: "invoice-1",
            provider: "EFAKTURA",
            mode: "SANDBOX",
            ublSha256: "hash-1",
          },
        },
      }),
    );
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "EINVOICE_UBL_PREPARED",
        entityId: "transmission-1",
      }),
    });
  });

  it("nespustí starší validačný zápis cez novší stav z webhooku", async () => {
    mocks.transmissionUpdateMany.mockResolvedValue({ count: 0 });
    mocks.transmissionFindUniqueOrThrow.mockResolvedValue({
      ...selectedTransmission,
      status: "DELIVERED",
    });

    const result = await new PrismaOutgoingEInvoiceRepository().recordValidation({
      transmissionId: "transmission-1",
      accepted: true,
      connector: {
        status: "VALIDATED",
        sendReady: true,
        validatorUnavailable: false,
        validation: {
          ran: true,
          valid: true,
          errorCount: 0,
          warningCount: 0,
        },
        repairFindings: [],
        repairsApplied: [],
      },
      recipient: {
        peppolId: "9915:2198765432",
        found: true,
        lookupUnavailable: false,
      },
      checkedAt: new Date("2026-08-18T14:00:00.000Z"),
    });

    expect(result.status).toBe("DELIVERED");
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
