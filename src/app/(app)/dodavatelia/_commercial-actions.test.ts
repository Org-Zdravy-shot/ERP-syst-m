import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
  supplierFindUnique: vi.fn(),
  materialFindUnique: vi.fn(),
  productFindUnique: vi.fn(),
  catalogFindFirst: vi.fn(),
  invoiceFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  catalogUpdateMany: vi.fn(),
  catalogCreate: vi.fn(),
  priceFindFirst: vi.fn(),
  priceUpdateMany: vi.fn(),
  priceCreate: vi.fn(),
  returnableFindFirst: vi.fn(),
  returnableMovementCreate: vi.fn(),
  invoiceUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    supplier: { findUnique: mocks.supplierFindUnique },
    material: { findUnique: mocks.materialFindUnique },
    product: { findUnique: mocks.productFindUnique },
    supplierCatalogItem: { findFirst: mocks.catalogFindFirst },
    invoice: { findUnique: mocks.invoiceFindUnique },
  },
}));

import {
  createSupplierAccountEntry,
  createSupplierCatalogItem,
  createSupplierPrice,
  createSupplierReturnableMovement,
  linkSupplierInvoice,
} from "./_commercial-actions";

function transactionClient() {
  return {
    $queryRaw: mocks.queryRaw,
    supplierCatalogItem: {
      updateMany: mocks.catalogUpdateMany,
      create: mocks.catalogCreate,
    },
    supplierPrice: {
      findFirst: mocks.priceFindFirst,
      updateMany: mocks.priceUpdateMany,
      create: mocks.priceCreate,
    },
    supplierReturnableType: { findFirst: mocks.returnableFindFirst },
    supplierReturnableMovement: { create: mocks.returnableMovementCreate },
    supplierAccountEntry: { create: vi.fn() },
    invoice: { updateMany: mocks.invoiceUpdateMany },
    auditLog: { create: mocks.auditCreate },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    userId: "admin-1",
    email: "admin@zdravyshot.sk",
    role: "admin",
  });
  mocks.supplierFindUnique.mockResolvedValue({ id: "supplier-1", name: "Medár", isActive: true });
  mocks.materialFindUnique.mockResolvedValue({ id: "material-1" });
  mocks.catalogFindFirst.mockResolvedValue({ id: "catalog-1", name: "Med 30 kg" });
  mocks.catalogCreate.mockResolvedValue({
    id: "catalog-1",
    name: "Med 30 kg",
    materialId: "material-1",
    productId: null,
    isPreferred: true,
  });
  mocks.priceFindFirst.mockResolvedValue(null);
  mocks.priceCreate.mockImplementation(async ({ data }) => ({ id: "price-1", ...data }));
  mocks.auditCreate.mockResolvedValue({});
  mocks.queryRaw.mockResolvedValue([{ id: "locked" }]);
  mocks.transaction.mockImplementation(async (callback) => callback(transactionClient()));
});

test("bežný používateľ nemôže meniť ponuky ani finančný ledger", async () => {
  mocks.requireUser.mockResolvedValue({ userId: "user-1", email: "user@example.sk", role: "user" });
  const offer = new FormData();
  const account = new FormData();

  await expect(createSupplierCatalogItem("supplier-1", {}, offer)).resolves.toEqual({
    error: "Túto operáciu môže vykonať iba finančný administrátor.",
  });
  await expect(createSupplierAccountEntry("supplier-1", {}, account)).resolves.toEqual({
    error: "Túto operáciu môže vykonať iba finančný administrátor.",
  });
  expect(mocks.transaction).not.toHaveBeenCalled();
});

test("preferovaná ponuka uzamkne položku, zruší starú preferenciu a audituje zmenu", async () => {
  const form = new FormData();
  form.set("itemRef", "material:material-1");
  form.set("name", "Med 30 kg");
  form.set("unit", "kg");
  form.set("packQuantity", "30");
  form.set("minOrderQuantity", "30");
  form.set("orderMultiple", "30");
  form.set("leadTimeDays", "7");
  form.set("isPreferred", "on");

  await expect(createSupplierCatalogItem("supplier-1", {}, form)).resolves.toEqual({
    success: "Ponuka „Med 30 kg“ bola pridaná.",
  });

  expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  expect(mocks.catalogUpdateMany).toHaveBeenCalledWith({
    where: { materialId: "material-1" },
    data: { isPreferred: false },
  });
  expect(mocks.catalogCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ supplierId: "supplier-1", materialId: "material-1", isPreferred: true }),
  });
  expect(mocks.auditCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ action: "SUPPLIER_CATALOG_ITEM_CREATED", entityId: "catalog-1" }),
  });
});

test("nová cena uzatvorí starú cenu rovnakého pásma jednu milisekundu pred začiatkom", async () => {
  const form = new FormData();
  form.set("unitPrice", "4,50");
  form.set("pricePerQuantity", "1");
  form.set("minimumQuantity", "30");
  form.set("priceType", "NET");
  form.set("vatRate", "23");
  form.set("validFrom", "2026-10-01");

  await expect(createSupplierPrice("supplier-1", "catalog-1", {}, form)).resolves.toEqual({
    success: "Nová cena pre „Med 30 kg“ bola uložená.",
  });

  const validFrom = new Date("2026-10-01T00:00:00.000Z");
  expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  expect(mocks.priceUpdateMany).toHaveBeenCalledWith({
    where: {
      catalogItemId: "catalog-1",
      minimumQuantity: 30,
      validFrom: { lt: validFrom },
      OR: [{ validTo: null }, { validTo: { gte: validFrom } }],
    },
    data: { validTo: new Date("2026-09-30T23:59:59.999Z") },
  });
  expect(mocks.priceCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ unitPriceCents: 450, vatRate: 23, validFrom }),
  });
});

test("vratný ledger nepovolí vrátiť viac obalov než je evidovaný zostatok", async () => {
  mocks.requireUser.mockResolvedValue({ userId: "user-1", email: "user@example.sk", role: "user" });
  mocks.returnableFindFirst.mockResolvedValue({
    id: "returnable-1",
    unit: "ks",
    movements: [{ quantity: 2 }],
  });
  const form = new FormData();
  form.set("direction", "DECREASE");
  form.set("quantity", "3");
  form.set("occurredAt", "2026-08-18");

  await expect(createSupplierReturnableMovement("supplier-1", "returnable-1", {}, form)).resolves.toEqual({
    error: "Nemožno vrátiť viac než aktuálny zostatok 2 ks.",
  });
  expect(mocks.returnableMovementCreate).not.toHaveBeenCalled();
  expect(mocks.auditCreate).not.toHaveBeenCalled();
});

test("súbežné priradenie faktúry ju nemôže presunúť k inému dodávateľovi", async () => {
  mocks.invoiceFindUnique.mockResolvedValue({ id: "invoice-1", direction: "PRIJATA", supplierId: null });
  mocks.invoiceUpdateMany.mockResolvedValue({ count: 0 });
  const form = new FormData();
  form.set("invoiceId", "invoice-1");

  await expect(linkSupplierInvoice("supplier-1", {}, form)).resolves.toEqual({
    error: "Faktúru medzitým priradil iný používateľ. Obnovte stránku.",
  });
  expect(mocks.auditCreate).not.toHaveBeenCalled();
});
