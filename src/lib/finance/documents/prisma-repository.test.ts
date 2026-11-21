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
import { renderPeppolBisUbl } from "../einvoice/ubl";

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
    buyerReference: "BUYER-42",
    note: fixture.note,
    issuerSnapshot: fixture.issuer,
    counterpartySnapshot: fixture.counterparty,
    taxSnapshot: fixture.tax,
    totalNetCents: fixture.totalNetCents,
    totalVatCents: fixture.totalVatCents,
    totalGrossCents: fixture.totalGrossCents,
    order: { orderNumber: "OBJ2026-0042" },
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
      order: null,
      originalInvoice: {
        invoiceNumber: "2026008",
        order: { orderNumber: "OBJ2026-0041" },
      },
    }),
  );

  const data = await new PrismaDocumentRepository().getInvoicePdfData(
    "invoice-test-1",
  );
  expect(data?.originalInvoiceNumber).toBe("2026008");
  expect(data?.buyerReference).toBe("BUYER-42");
});

test("faktúra prenesie explicitnú referenciu odberateľa do BuyerReference", async () => {
  mocks.findUnique.mockResolvedValue(databaseInvoice());

  const data = await new PrismaDocumentRepository().getInvoicePdfData(
    "invoice-test-1",
  );

  expect(data?.buyerReference).toBe("BUYER-42");
});

test("interné číslo objednávky nenahradí chýbajúcu referenciu odberateľa", async () => {
  mocks.findUnique.mockResolvedValue(databaseInvoice({ buyerReference: null }));
  const data = await new PrismaDocumentRepository().getInvoicePdfData("invoice-test-1");
  expect(data?.buyerReference).toBeUndefined();
});

test("PDF podklad prečíta presnú cenu položky", async () => {
  const record = databaseInvoice();
  const items = record.items as Array<Record<string, unknown>>;
  items[0].unitPriceExact = { toString: () => "1.8270" };
  mocks.findUnique.mockResolvedValue(record);
  const data = await new PrismaDocumentRepository().getInvoicePdfData("invoice-test-1");
  expect(data?.lines[0].unitPriceExact).toBe("1.8270");
});

test("UBL reads FMCG from the invoice snapshot without consulting the product catalog", async () => {
  const record = databaseInvoice();
  const items = record.items as Array<Record<string, unknown>>;
  items[0].fmcgSnapshot = { gtin: "8589000072245", properties: { buyer_order_number: "101-42", batch_number: "LOT-7" } };
  mocks.findUnique.mockResolvedValue(record);
  const data = await new PrismaDocumentRepository().getInvoicePdfData("invoice-test-1");
  expect(data?.lines[0].fmcg).toEqual(items[0].fmcgSnapshot);
  const rendered = renderPeppolBisUbl({ ...data!, buyerReference: "101-42", sellerEndpoint: { schemeId: "0245", value: "2123456789" }, buyerEndpoint: { schemeId: "0245", value: "2020188588" } });
  expect(rendered.xml).toContain("<cbc:Name>batch_number</cbc:Name><cbc:Value>LOT-7</cbc:Value>");
  expect(rendered.xml).toContain('schemeID="0160">8589000072245');
});

test("corrupt stored FMCG is rejected with the exact row and field", async () => {
  const record = databaseInvoice();
  (record.items as Array<Record<string, unknown>>)[0].fmcgSnapshot = { properties: { expiry_date: "2027-02-30" } };
  mocks.findUnique.mockResolvedValue(record);
  await expect(new PrismaDocumentRepository().getInvoicePdfData("invoice-test-1")).rejects.toThrow("Riadok 1, FMCG properties.expiry_date");
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
