import type { DocumentService } from "@/lib/finance/contracts";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  outboxFindFirst: vi.fn(),
  outboxUpdateMany: vi.fn(),
  outboxFindUniqueOrThrow: vi.fn(),
  outboxUpdate: vi.fn(),
  invoiceFindUnique: vi.fn(),
  enqueueOutbox: vi.fn(),
  sendInvoiceEmail: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    outboxEvent: {
      findFirst: mocks.outboxFindFirst,
      updateMany: mocks.outboxUpdateMany,
      findUniqueOrThrow: mocks.outboxFindUniqueOrThrow,
      update: mocks.outboxUpdate,
    },
    invoice: {
      findUnique: mocks.invoiceFindUnique,
    },
  },
}));

vi.mock("./enqueue", () => ({
  enqueueOutbox: mocks.enqueueOutbox,
}));

vi.mock("@/lib/finance/mail/email-service", () => ({
  sendInvoiceEmail: mocks.sendInvoiceEmail,
}));

vi.mock("./composition", () => ({
  getMailProvider: vi.fn(() => {
    throw new Error("Test nesmie vytvoriť produkčný mail provider.");
  }),
  getWorkerDocumentService: vi.fn(() => {
    throw new Error("Test musí dodať dokumentovú službu.");
  }),
}));

import {
  OUTBOX_LOCK_TIMEOUT_MS,
  processPendingOutbox,
} from "./worker";

const now = new Date("2026-07-24T12:00:00.000Z");

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.outboxUpdateMany.mockResolvedValue({ count: 0 });
  mocks.outboxUpdate.mockResolvedValue({});
  mocks.outboxFindFirst.mockResolvedValue(null);
});

test("worker obnoví zaseknuté PROCESSING udalosti po časovom limite", async () => {
  await processPendingOutbox(1, { now: () => now });

  const staleBefore = new Date(now.getTime() - OUTBOX_LOCK_TIMEOUT_MS);
  expect(mocks.outboxUpdateMany).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      where: expect.objectContaining({
        status: "PROCESSING",
        lockedAt: { lt: staleBefore },
      }),
      data: expect.objectContaining({
        status: "PENDING",
        attempts: { increment: 1 },
        lockedAt: null,
      }),
    }),
  );
});

test("neopakovateľná chyba započíta pokus a udalosť ukončí", async () => {
  mocks.outboxFindFirst.mockResolvedValue({ id: "event-1" });
  mocks.outboxUpdateMany
    .mockResolvedValueOnce({ count: 0 })
    .mockResolvedValueOnce({ count: 0 })
    .mockResolvedValueOnce({ count: 1 });
  mocks.outboxFindUniqueOrThrow.mockResolvedValue({
    id: "event-1",
    type: "UNKNOWN",
    payload: {},
    attempts: 2,
  });

  const summary = await processPendingOutbox(1, { now: () => now });

  expect(summary).toEqual({
    processed: 1,
    done: 0,
    retried: 0,
    failed: 1,
  });
  expect(mocks.outboxUpdate).toHaveBeenCalledWith({
    where: { id: "event-1" },
    data: expect.objectContaining({
      status: "FAILED",
      attempts: 3,
      lockedAt: null,
    }),
  });
});

test("PDF udalosť vytvorí dokument a e-mail zaradí zo snapshotu", async () => {
  const generateAndStoreInvoicePdf = vi.fn().mockResolvedValue({});
  const documentService = {
    generateAndStoreInvoicePdf,
  } as unknown as DocumentService;
  mocks.outboxFindFirst.mockResolvedValue({ id: "event-pdf" });
  mocks.outboxUpdateMany
    .mockResolvedValueOnce({ count: 0 })
    .mockResolvedValueOnce({ count: 0 })
    .mockResolvedValueOnce({ count: 1 });
  mocks.outboxFindUniqueOrThrow.mockResolvedValue({
    id: "event-pdf",
    type: "INVOICE_PDF",
    payload: { invoiceId: "invoice-1", actorId: "user-1" },
    attempts: 0,
  });
  mocks.invoiceFindUnique.mockResolvedValue({
    direction: "VYDANA",
    counterpartySnapshot: { email: "odberatel@example.sk" },
  });
  mocks.enqueueOutbox.mockResolvedValue({
    created: true,
    eventId: "event-email",
  });

  const summary = await processPendingOutbox(1, {
    now: () => now,
    documentService,
  });

  expect(summary.done).toBe(1);
  expect(generateAndStoreInvoicePdf).toHaveBeenCalledWith("invoice-1");
  expect(mocks.enqueueOutbox).toHaveBeenCalledWith({
    type: "INVOICE_EMAIL",
    aggregateType: "Invoice",
    aggregateId: "invoice-1",
    idempotencyKey: "invoice:invoice-1:auto-email",
    payload: { invoiceId: "invoice-1", actorId: "user-1" },
  });
});
