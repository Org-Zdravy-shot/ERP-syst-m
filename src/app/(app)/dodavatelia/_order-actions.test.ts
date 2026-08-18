import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  nextNumber: vi.fn(),
  queryRaw: vi.fn(),
  supplierFindUnique: vi.fn(),
  catalogFindMany: vi.fn(),
  orderFindUnique: vi.fn(),
  orderCreate: vi.fn(),
  orderUpdate: vi.fn(),
  deliveryFindUnique: vi.fn(),
  deliveryCreate: vi.fn(),
  deliveryItemCreate: vi.fn(),
  returnableFindMany: vi.fn(),
  returnableMovementCreate: vi.fn(),
  stockMovementCreate: vi.fn(),
  stockAggregate: vi.fn(),
  materialFindUnique: vi.fn(),
  supplierOrderItemFindMany: vi.fn(),
  materialUpdate: vi.fn(),
  productUpdate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/invoicing", () => ({ nextNumber: mocks.nextNumber }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import {
  createSupplierOrder,
  createReplenishmentDrafts,
  receiveSupplierOrder,
  transitionSupplierOrder,
} from "./_order-actions";

function transactionClient() {
  return {
    $queryRaw: mocks.queryRaw,
    supplier: { findUnique: mocks.supplierFindUnique },
    supplierCatalogItem: { findMany: mocks.catalogFindMany },
    supplierOrderItem: { findMany: mocks.supplierOrderItemFindMany },
    supplierOrder: {
      findUnique: mocks.orderFindUnique,
      create: mocks.orderCreate,
      update: mocks.orderUpdate,
    },
    supplierDelivery: {
      findUnique: mocks.deliveryFindUnique,
      create: mocks.deliveryCreate,
    },
    supplierDeliveryItem: { create: mocks.deliveryItemCreate },
    supplierReturnableType: { findMany: mocks.returnableFindMany },
    supplierReturnableMovement: { create: mocks.returnableMovementCreate },
    stockMovement: { create: mocks.stockMovementCreate, aggregate: mocks.stockAggregate },
    material: { findUnique: mocks.materialFindUnique, update: mocks.materialUpdate },
    product: { findUnique: vi.fn(), update: mocks.productUpdate },
    auditLog: { create: mocks.auditCreate },
  };
}

function orderForm(quantity = 30) {
  const form = new FormData();
  form.set("supplierId", "supplier-1");
  form.set("shipping", "0");
  form.set("discount", "0");
  form.set("items", JSON.stringify([{ catalogItemId: "offer-1", quantity }]));
  return form;
}

function receiptForm(quantity: number, idempotencyKey = "receipt_key_123456789") {
  const form = new FormData();
  form.set("idempotencyKey", idempotencyKey);
  form.set("receivedAt", "2026-08-18");
  form.set("items", JSON.stringify([{ orderItemId: "item-1", quantity }]));
  form.set("returnables", "[]");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: "admin-1", email: "admin@zdravyshot.sk", role: "admin" });
  mocks.transaction.mockImplementation(async (callback) => callback(transactionClient()));
  mocks.nextNumber.mockResolvedValue("NO2026009");
  mocks.supplierFindUnique.mockResolvedValue({ id: "supplier-1", name: "Medár", isActive: true });
  mocks.catalogFindMany.mockResolvedValue([{
    id: "offer-1",
    supplierId: "supplier-1",
    materialId: "material-1",
    productId: null,
    supplierSku: "MED30",
    name: "Med 30 kg",
    unit: "kg",
    packQuantity: 30,
    minOrderQuantity: 30,
    orderMultiple: 30,
    prices: [{
      unitPriceCents: 9_000,
      pricePerQuantity: 30,
      minimumQuantity: 0,
      priceType: "NET",
      vatRate: 23,
      validFrom: new Date("2026-01-01"),
      validTo: null,
    }],
  }]);
  mocks.orderCreate.mockResolvedValue({ id: "order-1", supplierId: "supplier-1" });
  mocks.auditCreate.mockResolvedValue({});
  mocks.redirect.mockImplementation(() => { throw new Error("redirect"); });
  mocks.queryRaw.mockResolvedValue([{ id: "locked" }]);
  mocks.deliveryFindUnique.mockResolvedValue(null);
  mocks.returnableFindMany.mockResolvedValue([]);
  mocks.deliveryCreate.mockResolvedValue({ id: "delivery-1" });
  mocks.stockMovementCreate.mockResolvedValue({ id: "movement-1" });
  mocks.deliveryItemCreate.mockResolvedValue({ id: "delivery-item-1" });
  mocks.orderUpdate.mockResolvedValue({});
  mocks.stockAggregate.mockResolvedValue({ _sum: { quantity: 2 } });
  mocks.materialFindUnique.mockResolvedValue({ isActive: true, minStock: 10, targetStock: 20 });
  mocks.supplierOrderItemFindMany.mockResolvedValue([]);
});

test("koncept môže vytvoriť iba používateľ s finančným oprávnením", async () => {
  mocks.requireUser.mockResolvedValue({ userId: "user-1", email: "user@example.sk", role: "user" });
  await expect(createSupplierOrder({}, orderForm())).resolves.toEqual({
    error: "Na túto operáciu nemáte finančné oprávnenie.",
  });
  expect(mocks.transaction).not.toHaveBeenCalled();
});

test("server odvodí cenu a cenovú jednotku z platnej ponuky", async () => {
  await expect(createSupplierOrder({}, orderForm())).rejects.toThrow("redirect");
  expect(mocks.nextNumber).toHaveBeenCalledWith(expect.anything(), "NAKUP", expect.any(Number));
  expect(mocks.orderCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({
      orderNumber: "NO2026009",
      supplierId: "supplier-1",
      items: {
        create: [expect.objectContaining({
          catalogItemId: "offer-1",
          quantity: 30,
          unitPriceCents: 9_000,
          pricePerQuantity: 30,
          vatRate: 23,
        })],
      },
    }),
  });
  expect(mocks.auditCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ action: "SUPPLIER_ORDER_CREATED", entityId: "order-1" }),
  });
});

test("server odmietne množstvo mimo balenia a objednávkového kroku", async () => {
  await expect(createSupplierOrder({}, orderForm(31))).resolves.toMatchObject({
    error: expect.stringContaining("musí rešpektovať balenie"),
  });
  expect(mocks.orderCreate).not.toHaveBeenCalled();
});

test("bežný používateľ nemôže označiť objednávku ako odoslanú", async () => {
  mocks.requireUser.mockResolvedValue({ userId: "user-1", email: "user@example.sk", role: "user" });
  await expect(transitionSupplierOrder("order-1", "SENT", {}, new FormData())).resolves.toEqual({
    error: "Na túto zmenu stavu nemáte oprávnenie.",
  });
  expect(mocks.transaction).not.toHaveBeenCalled();
});

test("príjem odmietne množstvo nad zostávajúci počet", async () => {
  mocks.orderFindUnique.mockResolvedValue({
    id: "order-1",
    orderNumber: "NO2026009",
    supplierId: "supplier-1",
    status: "CONFIRMED",
    supplier: { id: "supplier-1" },
    items: [{
      id: "item-1",
      description: "Med 30 kg",
      unit: "kg",
      quantity: 10,
      materialId: "material-1",
      productId: null,
      unitPriceCents: 3_000,
      pricePerQuantity: 1,
      deliveryItems: [{ quantity: 8 }],
    }],
  });
  await expect(receiveSupplierOrder("order-1", {}, receiptForm(3))).resolves.toMatchObject({
    error: expect.stringContaining("prekračuje zostávajúce množstvo 2 kg"),
  });
  expect(mocks.deliveryCreate).not.toHaveBeenCalled();
});

test("plný príjem vytvorí jeden skladový pohyb, aktualizuje cenu a uzavrie objednávku", async () => {
  mocks.orderFindUnique.mockResolvedValue({
    id: "order-1",
    orderNumber: "NO2026009",
    supplierId: "supplier-1",
    status: "PARTIALLY_RECEIVED",
    supplier: { id: "supplier-1" },
    items: [{
      id: "item-1",
      description: "Med 30 kg",
      unit: "kg",
      quantity: 10,
      materialId: "material-1",
      productId: null,
      unitPriceCents: 3_000,
      pricePerQuantity: 10,
      deliveryItems: [{ quantity: 5 }],
    }],
  });

  await expect(receiveSupplierOrder("order-1", {}, receiptForm(5))).resolves.toEqual({
    success: "Príjem bol uložený a zásoby prepočítané.",
  });
  expect(mocks.stockMovementCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ type: "PRIJEM", materialId: "material-1", quantity: 5, unitPriceCents: 300 }),
  });
  expect(mocks.materialUpdate).toHaveBeenCalledWith({ where: { id: "material-1" }, data: { lastPriceCents: 300 } });
  expect(mocks.deliveryItemCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ supplierDeliveryId: "delivery-1", stockMovementId: "movement-1" }),
  });
  expect(mocks.orderUpdate).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { status: "RECEIVED" } });
});

test("opakovaný idempotency kľúč nevytvorí druhý príjem", async () => {
  mocks.deliveryFindUnique.mockResolvedValue({ id: "delivery-existing" });
  await expect(receiveSupplierOrder("order-1", {}, receiptForm(5))).resolves.toEqual({
    success: "Tento príjem už bol uložený; nevytvorili sa duplikáty.",
  });
  expect(mocks.orderFindUnique).not.toHaveBeenCalled();
  expect(mocks.deliveryCreate).not.toHaveBeenCalled();
  expect(mocks.stockMovementCreate).not.toHaveBeenCalled();
});

test("doobjednanie na serveri znovu prepočíta stav a vytvorí iba koncept", async () => {
  mocks.catalogFindMany.mockResolvedValue([{
    id: "offer-1",
    supplierId: "supplier-1",
    supplier: { id: "supplier-1", isActive: true },
    materialId: "material-1",
    productId: null,
    supplierSku: "MED5",
    name: "Med",
    unit: "kg",
    isActive: true,
    packQuantity: 5,
    minOrderQuantity: 5,
    orderMultiple: 5,
    leadTimeDays: 7,
    prices: [{ unitPriceCents: 500, pricePerQuantity: 1, minimumQuantity: 0, priceType: "NET", vatRate: 23, validFrom: new Date("2026-01-01"), validTo: null }],
  }]);
  const form = new FormData();
  form.set("items", JSON.stringify([{ kind: "material", itemId: "material-1", catalogItemId: "offer-1", quantity: 20 }]));

  await expect(createReplenishmentDrafts({}, form)).rejects.toThrow("redirect");
  expect(mocks.orderCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({
      supplierId: "supplier-1",
      note: expect.stringContaining("doobjednania"),
      items: { create: [expect.objectContaining({ catalogItemId: "offer-1", quantity: 20 })] },
    }),
  });
  expect(mocks.auditCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ action: "SUPPLIER_ORDER_CREATED_FROM_REPLENISHMENT" }),
  });
});

test("stará obrazovka doobjednania nevytvorí duplicitný koncept, ak stav už pokrýva otvorená objednávka", async () => {
  mocks.catalogFindMany.mockResolvedValue([{
    id: "offer-1",
    supplierId: "supplier-1",
    supplier: { id: "supplier-1", isActive: true },
    materialId: "material-1",
    productId: null,
    supplierSku: null,
    name: "Med",
    unit: "kg",
    isActive: true,
    packQuantity: 5,
    minOrderQuantity: 5,
    orderMultiple: 5,
    leadTimeDays: 7,
    prices: [{ unitPriceCents: 500, pricePerQuantity: 1, minimumQuantity: 0, priceType: "NET", vatRate: 23, validFrom: new Date("2026-01-01"), validTo: null }],
  }]);
  mocks.supplierOrderItemFindMany.mockResolvedValue([{ quantity: 10, deliveryItems: [] }]);
  const form = new FormData();
  form.set("items", JSON.stringify([{ kind: "material", itemId: "material-1", catalogItemId: "offer-1", quantity: 20 }]));

  await expect(createReplenishmentDrafts({}, form)).resolves.toMatchObject({
    error: expect.stringContaining("pokrýva otvorená objednávka"),
  });
  expect(mocks.orderCreate).not.toHaveBeenCalled();
});
