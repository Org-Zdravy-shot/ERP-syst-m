import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), nextNumber: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn(),
  transaction: vi.fn(), findUnique: vi.fn(), create: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/invoicing", () => ({ nextNumber: mocks.nextNumber }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction, order: { findUnique: mocks.findUnique } } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { createOrder } from "./_actions";

function orderForm(price = "1,827") {
  const data = new FormData();
  const values = { clientId: "gleistein", channel: "MANUAL", deliveryDate: "2026-11-04", latestDeliveryDate: "2026-11-05", deliveryContact: "Marta Omachelová", paymentMethod: "UNAGREED", note: "Zákazník sa pýta na kartu alebo faktúru.", submissionKey: "11111111-1111-4111-8111-111111111111" };
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  data.set("items", JSON.stringify([{ productId: "shot-60", quantity: 150, unitPriceExact: price, vatRate: 23, priceSource: "MANUAL", minimumExpiryDate: "2027-07-31" }]));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: "user" });
  mocks.nextNumber.mockResolvedValue("OBJ2026-0002");
  mocks.create.mockResolvedValue({ id: "order-2" });
  mocks.transaction.mockImplementation((callback) => callback({ order: { create: mocks.create } }));
});

test("uloží Gleistein s presnou cenou, dodaním a bez dohodnutej platby", async () => {
  await createOrder({}, orderForm());
  expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    orderNumber: "OBJ2026-0002", clientId: "gleistein", paymentMethod: "UNAGREED", deliveryContact: "Marta Omachelová",
    items: { create: [{ productId: "shot-60", quantity: 150, unitPriceExact: "1.8270", unitPriceCents: 183, vatRate: 23, priceSource: "MANUAL", minimumExpiryDate: new Date("2027-07-31") }] },
  }) });
  expect(mocks.redirect).toHaveBeenCalledWith("/objednavky/order-2?ulozene=1");
});

test("pri neplatnej cene vráti konkrétnu chybu ceny a nič nevytvorí", async () => {
  const result = await createOrder({}, orderForm("1,82755"));
  expect(result).toMatchObject({ priceErrorIndex: 0, error: expect.stringMatching(/Cena pri položke 1/) });
  expect(mocks.transaction).not.toHaveBeenCalled();
});

test("pri opakovaní rovnakého podania otvorí už vytvorenú objednávku", async () => {
  mocks.transaction.mockRejectedValueOnce(new Error("unique constraint"));
  mocks.findUnique.mockResolvedValueOnce({ id: "order-2" });
  await createOrder({}, orderForm());
  expect(mocks.redirect).toHaveBeenCalledWith("/objednavky/order-2?ulozene=1");
});
