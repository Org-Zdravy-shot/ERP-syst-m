import { beforeEach, expect, test, vi } from "vitest";
import type { MailProvider } from "@/lib/finance/contracts";

const mocks = vi.hoisted(() => ({ findOrder: vi.fn(), transaction: vi.fn(), updateMany: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  supplierOrder: { findUnique: mocks.findOrder },
  $transaction: mocks.transaction,
} }));

import { sendSupplierOrderEmail } from "./order-email";

const now = new Date("2026-11-02T10:00:00.000Z");
const order = {
  id: "order-1", orderNumber: "NO2026001", status: "APPROVED", shippingCents: 0, discountCents: 0,
  supplierSnapshot: { name: "Dodávateľ fliaš", email: "dodavatel@example.sk" },
  deliveryLocationSnapshot: { legalName: "Zdravý Shot", street: "Hlavná 1", city: "Senica", zip: "90501" },
  items: [{ lineNumber: 1, description: "Fľaša 40 ml", supplierSku: "FL40", quantity: 1000, unit: "ks", unitPriceCents: 18, pricePerQuantity: 1, priceType: "NET", vatRate: 23 }],
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.findOrder.mockResolvedValue(order);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback({ supplierOrder: { updateMany: mocks.updateMany }, auditLog: { create: mocks.audit } }));
});

test("odošle objednávku s množstvom a označí ju ako odoslanú", async () => {
  const send = vi.fn().mockResolvedValue({ providerMessageId: "mail-1", acceptedRecipients: ["dodavatel@example.sk"], rejectedRecipients: [], submittedAt: now });
  const provider = { providerName: "TEST", send } as unknown as MailProvider;
  await sendSupplierOrderEmail({ orderId: "order-1", outboxEventId: "event-1", provider, now });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
    to: ["dodavatel@example.sk"],
    subject: "Nákupná objednávka NO2026001 – Zdravý Shot",
    text: expect.stringContaining("Fľaša 40 ml (FL40) — 1 000 ks"),
  }));
  expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "order-1", status: "APPROVED" }, data: { status: "SENT", sentAt: now } });
});

test("už odoslaná objednávka sa neopakuje", async () => {
  mocks.findOrder.mockResolvedValue({ ...order, status: "SENT" });
  const send = vi.fn();
  await sendSupplierOrderEmail({ orderId: "order-1", outboxEventId: "event-1", provider: { providerName: "TEST", send } as unknown as MailProvider, now });
  expect(send).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
});
