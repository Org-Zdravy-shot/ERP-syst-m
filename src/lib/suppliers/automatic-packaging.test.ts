import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findEnabled: vi.fn(), transaction: vi.fn(), lock: vi.fn(), supplier: vi.fn(), company: vi.fn(),
  material: vi.fn(), stock: vi.fn(), openLines: vi.fn(), createOrder: vi.fn(), audit: vi.fn(),
  nextNumber: vi.fn(), enqueue: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { material: { findMany: mocks.findEnabled }, $transaction: mocks.transaction } }));
vi.mock("@/lib/invoicing", () => ({ nextNumber: mocks.nextNumber }));
vi.mock("@/lib/finance/outbox/enqueue", () => ({ enqueueOutbox: mocks.enqueue }));
vi.mock("./order-email", () => ({ automaticPackagingMailReady: () => true }));

import { enqueueAutomaticPackagingOrders } from "./automatic-packaging";

const now = new Date("2026-11-02T10:00:00.000Z");
const price = { unitPriceCents: 18, pricePerQuantity: 1, minimumQuantity: 0, priceType: "NET", vatRate: 23, validFrom: new Date("2026-01-01"), validTo: null };
const materials = ["bottle-40", "bottle-200"].map((id) => ({
  id, name: id, unit: "ks", kind: "PACKAGING", isActive: true, autoReorder: true,
  autoOrderLegalEntity: "SOLE_TRADER", minStock: 200, targetStock: 500,
  supplierCatalogItems: [{ id: `offer-${id}`, supplierId: "supplier-1", unit: "ks", name: id, supplierSku: id, minOrderQuantity: 0, packQuantity: 100, orderMultiple: 100, leadTimeDays: 5, prices: [price] }],
}));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  const tx = {
    $queryRaw: mocks.lock,
    supplier: { findUnique: mocks.supplier },
    companyProfile: { findFirst: mocks.company },
    material: { findUnique: mocks.material },
    stockMovement: { aggregate: mocks.stock },
    supplierOrderItem: { findMany: mocks.openLines },
    supplierOrder: { create: mocks.createOrder },
    auditLog: { create: mocks.audit },
  };
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  mocks.findEnabled.mockResolvedValue(materials.map((material) => ({ id: material.id, autoOrderLegalEntity: material.autoOrderLegalEntity, supplierCatalogItems: [{ supplierId: "supplier-1" }] })));
  mocks.supplier.mockResolvedValue({ id: "supplier-1", name: "Dodávateľ fliaš", isActive: true, email: "dodavatel@example.sk", contacts: [] });
  mocks.company.mockResolvedValue({ legalName: "Zdravý Shot", ico: "12345678", dic: "1234567890", street: "Hlavná 1", city: "Senica", zip: "90501", country: "SK" });
  mocks.material.mockImplementation(async ({ where }: { where: { id: string } }) => materials.find((material) => material.id === where.id));
  mocks.stock.mockResolvedValue({ _sum: { quantity: 100 } });
  mocks.openLines.mockResolvedValue([]);
  mocks.createOrder.mockResolvedValue({ id: "order-1" });
  mocks.nextNumber.mockResolvedValue("NO2026001");
  mocks.enqueue.mockResolvedValue({ created: true, eventId: "event-1" });
});

test("spojí nízke zásoby dvoch fliaš do jednej objednávky a zaradí jeden e-mail", async () => {
  const summary = await enqueueAutomaticPackagingOrders(now);
  expect(summary).toEqual({ created: 1, skipped: 0 });
  expect(mocks.createOrder).toHaveBeenCalledTimes(1);
  expect(mocks.createOrder.mock.calls[0][0].data.items.create).toMatchObject([
    { materialId: "bottle-200", quantity: 400 },
    { materialId: "bottle-40", quantity: 400 },
  ]);
  expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: "SUPPLIER_ORDER_EMAIL", idempotencyKey: "supplier-order:order-1:email" }), expect.anything());
});

test("otvorená objednávka pokrýva minimum a ďalší e-mail nevznikne", async () => {
  mocks.openLines.mockResolvedValue([{ quantity: 400, deliveryItems: [] }]);
  expect(await enqueueAutomaticPackagingOrders(now)).toEqual({ created: 0, skipped: 0 });
  expect(mocks.createOrder).not.toHaveBeenCalled();
  expect(mocks.enqueue).not.toHaveBeenCalled();
});

test("neúplná preferovaná ponuka nevytvorí objednávku", async () => {
  mocks.findEnabled.mockResolvedValue([{ id: "bottle-40", autoOrderLegalEntity: "SOLE_TRADER", supplierCatalogItems: [] }]);
  expect(await enqueueAutomaticPackagingOrders(now)).toEqual({ created: 0, skipped: 1 });
  expect(mocks.transaction).not.toHaveBeenCalled();
});
