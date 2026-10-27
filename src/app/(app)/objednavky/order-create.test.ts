import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), nextNumber: vi.fn(), nextEntityNumber: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn(),
  transaction: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), deleteItems: vi.fn(), deleteCharges: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/invoicing", () => ({ nextNumber: mocks.nextNumber, nextEntityNumber: mocks.nextEntityNumber }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction, order: { findUnique: mocks.findUnique } } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { createOrder, updateOrder } from "./_actions";

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
  mocks.nextEntityNumber.mockResolvedValue("OBJK2026-0001");
  mocks.create.mockResolvedValue({ id: "order-2" });
  mocks.transaction.mockImplementation((callback) => callback({ order: { create: mocks.create, update: mocks.update, findFirst: mocks.findFirst }, orderItem: { deleteMany: mocks.deleteItems }, orderCharge: { deleteMany: mocks.deleteCharges } }));
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

test("Gleistein uloží dopravu 20 € ako službu predajcu a presnú položku", async () => {
  const data = orderForm();
  data.set("legalEntity", "KURGI");
  data.set("charges", JSON.stringify([{ kind: "SHIPPING", description: "Doprava", priceEur: "20,00", vatRate: 23, recipient: "SELLER", taxTreatment: "STANDARD" }]));
  await createOrder({}, data);
  expect(mocks.nextEntityNumber).toHaveBeenCalledWith(expect.anything(), "OBJ", 2026, "KURGI");
  expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    legalEntity: "KURGI",
    charges: { create: [{ kind: "SHIPPING", description: "Doprava", unitPriceCents: 2000, vatRate: 23, recipient: "SELLER", taxTreatment: "STANDARD", includedInSellerTotal: true }] },
    items: { create: [expect.objectContaining({ quantity: 150, unitPriceExact: "1.8270" })] },
  }) });
});

test("úprava OBJ2026-0002 nahradí dve obchádzkové položky jedinou presnou bez novej objednávky", async () => {
  mocks.findUnique.mockResolvedValueOnce({ id: "order-2", orderNumber: "OBJ2026-0002", status: "NOVA", orderDate: new Date("2026-10-26"), invoices: [] });
  const data = orderForm();
  data.set("charges", JSON.stringify([{ kind: "SHIPPING", description: "Doprava", priceEur: "20.00", vatRate: 23, recipient: "SELLER", taxTreatment: "STANDARD" }]));
  await updateOrder("order-2", {}, data);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.deleteItems).toHaveBeenCalledWith({ where: { orderId: "order-2" } });
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "order-2" }, data: expect.objectContaining({ items: { create: [expect.objectContaining({ quantity: 150, unitPriceExact: "1.8270" })] } }) });
  expect(mocks.redirect).toHaveBeenCalledWith("/objednavky/order-2?ulozene=1");
});

test("Zľavomat eviduje cudziu dopravu mimo príjmu predajcu a historické odoslanie", async () => {
  const data = orderForm("2,49");
  data.set("legalEntity", "SOLE_TRADER"); data.set("channel", "ZLAVOMAT"); data.set("orderDate", "2026-10-26"); data.set("externalId", "33404506");
  data.set("platformPaymentStatus", "CUSTOMER_PAID"); data.set("shipmentStatus", "SHIPPED_EXTERNALLY"); data.set("shippedAt", "2026-10-27");
  data.set("charges", JSON.stringify([{ kind: "SHIPPING", description: "Doprava SPS", priceEur: "2,99", vatRate: 0, recipient: "PLATFORM", taxTreatment: "UNVERIFIED" }]));
  await createOrder({}, data);
  expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    channel: "ZLAVOMAT", legalEntity: "SOLE_TRADER", orderDate: new Date("2026-10-26"), externalId: "33404506",
    platformPaymentStatus: "CUSTOMER_PAID", shipmentStatus: "SHIPPED_EXTERNALLY", shippedAt: new Date("2026-10-27"),
    charges: { create: [expect.objectContaining({ unitPriceCents: 299, recipient: "PLATFORM", includedInSellerTotal: false })] },
  }) });
});

test("služba môže byť samostatnou položkou bez skladového produktu", async () => {
  const data = orderForm(); data.set("items", "[]");
  data.set("charges", JSON.stringify([{ kind: "FEE", description: "Balenie", priceEur: "5,00", vatRate: 0, recipient: "SELLER", taxTreatment: "UNVERIFIED" }]));
  await createOrder({}, data);
  expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ items: { create: [] }, charges: { create: [expect.objectContaining({ description: "Balenie", includedInSellerTotal: true })] } }) });
});
