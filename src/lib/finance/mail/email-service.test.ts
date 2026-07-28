import type {
  MailMessage,
  MailProvider,
  MailResult,
} from "@/lib/finance/contracts";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoiceFindUnique: vi.fn(),
  deliveryFindUnique: vi.fn(),
  deliveryCreate: vi.fn(),
  deliveryUpdate: vi.fn(),
  documentFindFirst: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { findUnique: mocks.invoiceFindUnique },
    emailDelivery: {
      findUnique: mocks.deliveryFindUnique,
      create: mocks.deliveryCreate,
      update: mocks.deliveryUpdate,
    },
    documentAsset: { findFirst: mocks.documentFindFirst },
    auditLog: { create: mocks.auditCreate },
  },
}));

import { SkippedOutboxError } from "@/lib/finance/outbox/errors";
import { sendInvoiceEmail } from "./email-service";

class CapturingMailProvider implements MailProvider {
  readonly providerName = "TEST";
  readonly messages: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailResult> {
    this.messages.push(message);
    return {
      providerMessageId: "provider-message-1",
      acceptedRecipients: message.to,
      rejectedRecipients: [],
      submittedAt: new Date("2026-07-28T10:00:00.000Z"),
    };
  }

  async getDeliveryStatus(): Promise<"SENT"> {
    return "SENT";
  }
}

function invoice(allocatedCents: number) {
  return {
    id: "invoice-1",
    direction: "VYDANA",
    documentStatus: "ISSUED",
    documentType: "INVOICE",
    invoiceNumber: "2026009",
    totalGrossCents: 10_000,
    variableSymbol: "2026009",
    dueDate: new Date("2026-07-01T00:00:00.000Z"),
    issuerSnapshot: {
      name: "Zdravý Shot, s. r. o.",
      iban: "SK9611000000002918599669",
    },
    counterpartySnapshot: {
      name: "Odberateľ, s. r. o.",
      email: "odberatel@example.sk",
    },
    paymentAllocations:
      allocatedCents > 0 ? [{ amountCents: allocatedCents }] : [],
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.deliveryFindUnique.mockResolvedValue(null);
  mocks.deliveryCreate.mockResolvedValue({ id: "delivery-1" });
  mocks.deliveryUpdate.mockResolvedValue({});
  mocks.documentFindFirst.mockResolvedValue(null);
  mocks.auditCreate.mockResolvedValue({});
});

test("upomienka posiela iba zostávajúcu sumu z aktívnych alokácií", async () => {
  mocks.invoiceFindUnique.mockResolvedValue(invoice(6_000));
  const provider = new CapturingMailProvider();

  await sendInvoiceEmail({
    invoiceId: "invoice-1",
    kind: "REMINDER",
    outboxEventId: "event-1",
    provider,
    now: new Date("2026-07-28T00:00:00.000Z"),
  });

  expect(provider.messages).toHaveLength(1);
  expect(provider.messages[0]?.text).toContain("40,00 €");
  expect(provider.messages[0]?.text).not.toContain("100,00 €");
  expect(mocks.deliveryCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({
      provider: "TEST",
      toAddress: "odberatel@example.sk",
      documentId: null,
    }),
  });
});

test("worker preskočí upomienku, ak bola faktúra medzičasom uhradená", async () => {
  mocks.invoiceFindUnique.mockResolvedValue(invoice(10_000));
  const provider = new CapturingMailProvider();

  await expect(
    sendInvoiceEmail({
      invoiceId: "invoice-1",
      kind: "REMINDER",
      outboxEventId: "event-1",
      provider,
    }),
  ).rejects.toBeInstanceOf(SkippedOutboxError);
  expect(provider.messages).toHaveLength(0);
  expect(mocks.deliveryCreate).not.toHaveBeenCalled();
});
