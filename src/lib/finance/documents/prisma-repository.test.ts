import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: {
      findUnique: mocks.findUnique,
    },
    $transaction: mocks.transaction,
  },
}));

import { PrismaDocumentRepository } from "./prisma-repository";
import { createInvoicePdfFixture } from "./test-fixtures";

function databaseInvoice(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const fixture = createInvoicePdfFixture();
  return {
    id: fixture.id,
    direction: "VYDANA",
    documentType: fixture.documentType,
    documentStatus: "ISSUED",
    invoiceNumber: fixture.invoiceNumber,
    currency: fixture.currency,
    issueDate: fixture.issueDate,
    dueDate: fixture.dueDate,
    finalizedAt: fixture.finalizedAt,
    variableSymbol: fixture.variableSymbol,
    note: fixture.note,
    issuerSnapshot: fixture.issuer,
    counterpartySnapshot: fixture.counterparty,
    taxSnapshot: fixture.tax,
    totalNetCents: fixture.totalNetCents,
    totalVatCents: fixture.totalVatCents,
    totalGrossCents: fixture.totalGrossCents,
    originalInvoice: null,
    items: fixture.lines.map((line) => ({
      productId: line.productId ?? null,
      productSku: line.productSku ?? null,
      lineNumber: line.lineNumber,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      vatRate: line.vatRate,
      totalNetCents: line.totalNetCents,
      totalVatCents: line.totalVatCents,
      totalGrossCents: line.totalGrossCents,
      taxCategory: line.taxCategory ?? null,
    })),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.findUnique.mockReset();
  mocks.upsert.mockReset();
  mocks.auditCreate.mockReset();
  mocks.transaction.mockReset();
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      documentAsset: { upsert: mocks.upsert },
      auditLog: { create: mocks.auditCreate },
    }),
  );
});

test("dobropis prenesie číslo pôvodnej faktúry do PDF dát", async () => {
  mocks.findUnique.mockResolvedValue(
    databaseInvoice({
      documentType: "CREDIT_NOTE",
      originalInvoice: { invoiceNumber: "2026008" },
    }),
  );

  const data = await new PrismaDocumentRepository().getInvoicePdfData(
    "invoice-test-1",
  );
  expect(data?.originalInvoiceNumber).toBe("2026008");
});

test("dobropis bez čísla pôvodnej faktúry sa odmietne", async () => {
  mocks.findUnique.mockResolvedValue(
    databaseInvoice({ documentType: "CREDIT_NOTE", originalInvoice: null }),
  );

  await expect(
    new PrismaDocumentRepository().getInvoicePdfData("invoice-test-1"),
  ).rejects.toThrow(/pôvodnej faktúry/);
});

test("platiteľovi DPH musí snapshot zachovať IČ DPH", async () => {
  const fixture = createInvoicePdfFixture();
  mocks.findUnique.mockResolvedValue(
    databaseInvoice({
      issuerSnapshot: { ...fixture.issuer, icDph: undefined },
    }),
  );

  await expect(
    new PrismaDocumentRepository().getInvoicePdfData("invoice-test-1"),
  ).rejects.toThrow(/IČ DPH/);
});

test("doklad neplatiteľa nesmie obsahovať vyčíslenú DPH", async () => {
  const fixture = createInvoicePdfFixture();
  mocks.findUnique.mockResolvedValue(
    databaseInvoice({
      issuerSnapshot: { ...fixture.issuer, icDph: undefined },
      taxSnapshot: {
        ...fixture.tax,
        vatStatus: "NON_PAYER",
        vatRegisteredFrom: undefined,
      },
    }),
  );

  await expect(
    new PrismaDocumentRepository().getInvoicePdfData("invoice-test-1"),
  ).rejects.toThrow(/neplatiteľa DPH/);
});

test("načíta cieľ prílohy prijatej faktúry", async () => {
  mocks.findUnique.mockResolvedValue({
    id: "received-invoice-1",
    direction: "PRIJATA",
  });

  await expect(
    new PrismaDocumentRepository().getInvoiceAttachmentTarget(
      "received-invoice-1",
    ),
  ).resolves.toEqual({ id: "received-invoice-1", direction: "PRIJATA" });
});

test("uloženie prílohy a audit prebehnú v jednej databázovej transakcii", async () => {
  const createdAt = new Date("2026-08-18T10:00:00.000Z");
  mocks.upsert.mockResolvedValue({
    id: "attachment-1",
    invoiceId: "received-invoice-1",
    type: "ATTACHMENT",
    storageProvider: "RAILWAY_BUCKET",
    bucket: "finance-documents",
    objectKey: "finance/invoices/received-invoice-1/attachments/hash-1",
    fileName: "dodavatelska-faktura.pdf",
    contentType: "application/pdf",
    byteSize: 1234,
    sha256: "hash-1",
    isImmutable: true,
    createdAt,
    archivedAt: null,
  });

  const stored = await new PrismaDocumentRepository().saveUploadedAttachment({
    invoiceId: "received-invoice-1",
    type: "ATTACHMENT",
    storageProvider: "RAILWAY_BUCKET",
    bucket: "finance-documents",
    objectKey: "finance/invoices/received-invoice-1/attachments/hash-1",
    fileName: "dodavatelska-faktura.pdf",
    contentType: "application/pdf",
    byteSize: 1234,
    sha256: "hash-1",
    createdById: "finance-admin-1",
    actorId: "finance-admin-1",
    actorEmail: "admin@zdravyshot.sk",
  });

  expect(stored.id).toBe("attachment-1");
  expect(mocks.transaction).toHaveBeenCalledOnce();
  expect(mocks.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        objectKey:
          "finance/invoices/received-invoice-1/attachments/hash-1",
      },
      create: expect.objectContaining({
        type: "ATTACHMENT",
        isImmutable: true,
        createdById: "finance-admin-1",
      }),
    }),
  );
  expect(mocks.auditCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({
      actorId: "finance-admin-1",
      actorEmail: "admin@zdravyshot.sk",
      action: "DOCUMENT_ATTACHMENT_STORED",
      entityType: "DocumentAsset",
      entityId: "attachment-1",
    }),
  });
});
