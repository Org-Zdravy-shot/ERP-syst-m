import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { nextNumber } from "@/lib/invoicing";
import { enqueueOutbox } from "@/lib/finance/outbox/enqueue";
import { calculateSupplierOrderTotals, recommendedOrderQuantity, selectActiveSupplierPrice } from "./domain";
import { automaticPackagingMailReady } from "./order-email";

const OPEN_STATUSES = ["DRAFT", "APPROVED", "SENT", "CONFIRMED", "PARTIALLY_RECEIVED"];

export type AutomaticPackagingSummary = { created: number; skipped: number };

/**
 * Volá existujúci outbox cron. Iba výslovne zapnuté obaly; každý dodávateľ
 * dostane najviac jednu objednávku za beh. Riadky otvorených objednávok sa
 * započítajú skôr, než môže vzniknúť ďalší návrh.
 */
export async function enqueueAutomaticPackagingOrders(now = new Date()): Promise<AutomaticPackagingSummary> {
  const enabled = await prisma.material.findMany({
    where: { isActive: true, kind: "PACKAGING", autoReorder: true },
    select: { id: true, autoOrderLegalEntity: true, supplierCatalogItems: { where: { isActive: true, isPreferred: true, supplier: { isActive: true } }, select: { supplierId: true } } },
  });
  if (!automaticPackagingMailReady()) return { created: 0, skipped: enabled.length };
  const bySupplierAndEntity = new Map<string, { supplierId: string; legalEntity: string; materialIds: string[] }>();
  let skipped = 0;
  for (const material of enabled) {
    if (material.supplierCatalogItems.length !== 1 || !material.autoOrderLegalEntity) { skipped++; continue; }
    const supplierId = material.supplierCatalogItems[0].supplierId;
    const key = `${supplierId}:${material.autoOrderLegalEntity}`;
    const group = bySupplierAndEntity.get(key) ?? { supplierId, legalEntity: material.autoOrderLegalEntity, materialIds: [] };
    group.materialIds.push(material.id);
    bySupplierAndEntity.set(key, group);
  }

  let created = 0;
  for (const { supplierId, legalEntity, materialIds } of bySupplierAndEntity.values()) {
    const result = await prisma.$transaction(async (tx) => {
      const sortedIds = [...materialIds].sort();
      for (const id of sortedIds) await tx.$queryRaw`SELECT "id" FROM "Material" WHERE "id" = ${id} FOR UPDATE`;
      const supplier = await tx.supplier.findUnique({
        where: { id: supplierId },
        include: { contacts: { where: { isPrimary: true }, take: 1 } },
      });
      const email = [supplier?.contacts[0]?.email, supplier?.email].find((candidate) => z.email().safeParse(candidate).success);
      if (!supplier?.isActive || !email) return { created: false, skipped: sortedIds.length };
      const company = await tx.companyProfile.findFirst({
        where: { isActive: true, legalEntity, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }] },
        orderBy: { validFrom: "desc" },
      });
      if (!company) return { created: false, skipped: sortedIds.length };

      const lines: Array<{
        catalogItemId: string; materialId: string; lineNumber: number;
        description: string; supplierSku: string | null; quantity: number; unit: string;
        unitPriceCents: number; pricePerQuantity: number; priceType: "NET" | "GROSS"; vatRate: number;
      }> = [];
      let maxLeadTimeDays = 0;
      let skippedLines = 0;
      for (const id of sortedIds) {
        const material = await tx.material.findUnique({
          where: { id },
          include: { supplierCatalogItems: { where: { isActive: true, isPreferred: true, supplier: { isActive: true } }, include: { prices: true } } },
        });
        if (!material?.isActive || material.kind !== "PACKAGING" || !material.autoReorder || material.autoOrderLegalEntity !== legalEntity || material.minStock <= 0 || material.targetStock === null) { skippedLines++; continue; }
        const offers = material.supplierCatalogItems;
        if (offers.length !== 1 || offers[0].supplierId !== supplierId || offers[0].unit !== material.unit) { skippedLines++; continue; }
        const offer = offers[0];
        const stock = await tx.stockMovement.aggregate({ where: { materialId: id }, _sum: { quantity: true } });
        const currentQuantity = stock._sum.quantity ?? 0;
        if (currentQuantity < 0) { skippedLines++; continue; }
        const openLines = await tx.supplierOrderItem.findMany({
          where: { materialId: id, supplierOrder: { status: { in: OPEN_STATUSES } } },
          select: { quantity: true, deliveryItems: { select: { quantity: true } } },
        });
        const openOrderQuantity = openLines.reduce((sum, line) => sum + Math.max(0, line.quantity - line.deliveryItems.reduce((received, delivery) => received + delivery.quantity, 0)), 0);
        const quantity = recommendedOrderQuantity({
          currentQuantity, openOrderQuantity, minStock: material.minStock, targetStock: material.targetStock,
          minOrderQuantity: offer.minOrderQuantity, packQuantity: offer.packQuantity, orderMultiple: offer.orderMultiple,
        });
        if (quantity <= 0) continue;
        const price = selectActiveSupplierPrice(offer.prices, quantity, now);
        if (!price || price.vatRate === null || (price.priceType !== "NET" && price.priceType !== "GROSS")) { skippedLines++; continue; }
        lines.push({
          catalogItemId: offer.id, materialId: id, lineNumber: lines.length + 1,
          description: offer.name, supplierSku: offer.supplierSku, quantity, unit: offer.unit,
          unitPriceCents: price.unitPriceCents, pricePerQuantity: price.pricePerQuantity,
          priceType: price.priceType, vatRate: price.vatRate,
        });
        maxLeadTimeDays = Math.max(maxLeadTimeDays, offer.leadTimeDays);
      }
      if (lines.length === 0) return { created: false, skipped: skippedLines };
      calculateSupplierOrderTotals(lines);
      const orderNumber = await nextNumber(tx, "NAKUP", now.getFullYear());
      const order = await tx.supplierOrder.create({
        data: {
          orderNumber, supplierId, legalEntity, orderDate: now,
          status: "APPROVED", approvedAt: now,
          requestedDeliveryDate: new Date(now.getTime() + maxLeadTimeDays * 86_400_000),
          note: "Automatická objednávka obalov pri poklese zásob pod nastavené minimum.",
          supplierSnapshot: { name: supplier.name, legalName: supplier.legalName, ico: supplier.ico, email },
          deliveryLocationSnapshot: { legalName: company.legalName, ico: company.ico, dic: company.dic, street: company.street, city: company.city, zip: company.zip, country: company.country },
          items: { create: lines },
        },
      });
      await enqueueOutbox({
        type: "SUPPLIER_ORDER_EMAIL", aggregateType: "SupplierOrder", aggregateId: order.id,
        idempotencyKey: `supplier-order:${order.id}:email`, payload: { supplierOrderId: order.id },
      }, tx);
      await tx.auditLog.create({ data: {
        actorEmail: "system", action: "SUPPLIER_ORDER_AUTO_CREATED", entityType: "SupplierOrder", entityId: order.id,
        metadata: { supplierId, materialIds: lines.map((line) => line.materialId) },
        afterData: { orderNumber, status: "APPROVED", itemCount: lines.length },
      } });
      return { created: true, skipped: skippedLines };
    }, { timeout: 15_000 });
    if (result.created) created++;
    skipped += result.skipped;
  }
  return { created, skipped };
}
