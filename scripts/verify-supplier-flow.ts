import { Prisma, PrismaClient } from "@prisma/client";
import {
  calculateSupplierOrderTotals,
  deriveSupplierOrderReceiptStatus,
  supplierReturnableBalance,
} from "../src/lib/suppliers/domain";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Supplier integration check failed: ${message}`);
}

async function main() {
  const databaseRows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  const databaseName = databaseRows[0]?.name ?? "";
  if (!databaseName.includes("_verify_")) {
    throw new Error(`Safety stop: supplier integration check refuses database "${databaseName}".`);
  }

  const fixture = await prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.create({
      data: { kind: "COMPANY", name: "Integration Honey Supplier", source: "OTHER" },
    });
    const material = await tx.material.create({
      data: { name: "Integration honey", unit: "kg", minStock: 10, targetStock: 30 },
    });
    const offer = await tx.supplierCatalogItem.create({
      data: {
        supplierId: supplier.id,
        materialId: material.id,
        name: "Honey 30 kg",
        unit: "kg",
        packQuantity: 30,
        minOrderQuantity: 30,
        orderMultiple: 30,
        isPreferred: true,
      },
    });
    const price = await tx.supplierPrice.create({
      data: {
        catalogItemId: offer.id,
        unitPriceCents: 9_000,
        pricePerQuantity: 30,
        minimumQuantity: 0,
        priceType: "NET",
        vatRate: 23,
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const order = await tx.supplierOrder.create({
      data: {
        orderNumber: "NO-VERIFY-2026-001",
        supplierId: supplier.id,
        status: "CONFIRMED",
        items: {
          create: {
            catalogItemId: offer.id,
            materialId: material.id,
            description: offer.name,
            quantity: 30,
            unit: "kg",
            unitPriceCents: price.unitPriceCents,
            pricePerQuantity: price.pricePerQuantity,
            priceType: price.priceType,
            vatRate: price.vatRate ?? 0,
          },
        },
      },
      include: { items: true },
    });
    const returnableType = await tx.supplierReturnableType.create({
      data: { supplierId: supplier.id, name: "Integration honey container", owner: "SUPPLIER", expectedReturnDays: 365 },
    });
    return { supplier, material, order, orderItem: order.items[0], returnableType };
  });

  const totals = calculateSupplierOrderTotals([{
    quantity: fixture.orderItem.quantity,
    unitPriceCents: fixture.orderItem.unitPriceCents,
    pricePerQuantity: fixture.orderItem.pricePerQuantity,
    priceType: fixture.orderItem.priceType as "NET" | "GROSS",
    vatRate: fixture.orderItem.vatRate,
  }]);
  assert(totals.totalNetCents === 9_000 && totals.totalGrossCents === 11_070, "price basis or VAT total is wrong");

  for (const [index, quantity] of [12, 18].entries()) {
    await prisma.$transaction(async (tx) => {
      const movement = await tx.stockMovement.create({
        data: {
          type: "PRIJEM",
          materialId: fixture.material.id,
          supplierId: fixture.supplier.id,
          quantity,
          unitPriceCents: 300,
          note: `Integration receipt ${index + 1}`,
        },
      });
      const delivery = await tx.supplierDelivery.create({
        data: {
          supplierOrderId: fixture.order.id,
          idempotencyKey: `supplier_flow_verify_${index + 1}`,
          deliveryNoteNumber: `VERIFY-DL-${index + 1}`,
        },
      });
      await tx.supplierDeliveryItem.create({
        data: {
          supplierDeliveryId: delivery.id,
          supplierOrderItemId: fixture.orderItem.id,
          quantity,
          stockMovementId: movement.id,
        },
      });
      await tx.material.update({ where: { id: fixture.material.id }, data: { lastPriceCents: 300 } });
      if (index === 0) {
        await tx.supplierReturnableMovement.create({
          data: {
            returnableTypeId: fixture.returnableType.id,
            supplierDeliveryId: delivery.id,
            quantity: 2,
            occurredAt: new Date("2026-08-18T12:00:00.000Z"),
          },
        });
      }
    });
  }

  let duplicateRejected = false;
  try {
    await prisma.supplierDelivery.create({
      data: { supplierOrderId: fixture.order.id, idempotencyKey: "supplier_flow_verify_1" },
    });
  } catch (error) {
    duplicateRejected = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }
  assert(duplicateRejected, "duplicate delivery idempotency key was accepted");

  await prisma.supplierReturnableMovement.create({
    data: {
      returnableTypeId: fixture.returnableType.id,
      quantity: -1,
      occurredAt: new Date("2026-08-19T12:00:00.000Z"),
    },
  });
  const [deliveries, stock, material, returnableMovements] = await Promise.all([
    prisma.supplierDeliveryItem.aggregate({
      where: { supplierOrderItemId: fixture.orderItem.id },
      _sum: { quantity: true },
    }),
    prisma.stockMovement.aggregate({ where: { materialId: fixture.material.id }, _sum: { quantity: true } }),
    prisma.material.findUniqueOrThrow({ where: { id: fixture.material.id } }),
    prisma.supplierReturnableMovement.findMany({ where: { returnableTypeId: fixture.returnableType.id } }),
  ]);
  assert(deliveries._sum.quantity === 30, "partial deliveries do not add up to ordered quantity");
  assert(stock._sum.quantity === 30, "stock ledger does not match received quantity");
  assert(material.lastPriceCents === 300, "last material purchase price was not preserved");
  assert(deriveSupplierOrderReceiptStatus([{ orderedQuantity: 30, receivedQuantity: deliveries._sum.quantity ?? 0 }]) === "RECEIVED", "receipt status is not RECEIVED");
  assert(supplierReturnableBalance(returnableMovements.map((movement) => movement.quantity)) === 1, "returnable balance is wrong");

  process.stdout.write(JSON.stringify({
    database: databaseName,
    supplierCount: await prisma.supplier.count(),
    orderNumber: fixture.order.orderNumber,
    deliveryCount: await prisma.supplierDelivery.count(),
    stockQuantity: stock._sum.quantity,
    returnableBalance: 1,
    duplicateRejected,
    status: "ok",
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
