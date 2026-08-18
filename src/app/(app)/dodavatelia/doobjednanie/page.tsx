import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary, card, cardHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { prisma } from "@/lib/prisma";
import { ReplenishmentPlanner, StockTargetForm, type ReplenishmentItem } from "../ReplenishmentPlanner";

const OPEN_STATUSES = ["DRAFT", "APPROVED", "SENT", "CONFIRMED", "PARTIALLY_RECEIVED"];

export default async function DoobjednaniePage() {
  const session = await getSession();
  if (!hasFinancePermission(session.role, "VIEW")) redirect("/dodavatelia");
  const canConfigure = hasFinancePermission(session.role, "CONFIGURE");
  const [materials, products, materialStock, productStock, openOrderItems] = await Promise.all([
    prisma.material.findMany({
      where: { isActive: true },
      include: {
        supplierCatalogItems: {
          where: { isActive: true, supplier: { isActive: true } },
          include: { supplier: { select: { id: true, name: true } }, prices: true },
          orderBy: [{ isPreferred: "desc" }, { name: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      include: {
        supplierCatalogItems: {
          where: { isActive: true, supplier: { isActive: true } },
          include: { supplier: { select: { id: true, name: true } }, prices: true },
          orderBy: [{ isPreferred: "desc" }, { name: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.stockMovement.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { quantity: true } }),
    prisma.stockMovement.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { quantity: true } }),
    prisma.supplierOrderItem.findMany({
      where: { supplierOrder: { status: { in: OPEN_STATUSES } } },
      select: { materialId: true, productId: true, quantity: true, deliveryItems: { select: { quantity: true } } },
    }),
  ]);
  const materialStockMap = new Map(materialStock.flatMap((row) => row.materialId ? [[row.materialId, row._sum.quantity ?? 0] as const] : []));
  const productStockMap = new Map(productStock.flatMap((row) => row.productId ? [[row.productId, row._sum.quantity ?? 0] as const] : []));
  const openMaterial = new Map<string, number>();
  const openProduct = new Map<string, number>();
  for (const line of openOrderItems) {
    const remaining = Math.max(0, line.quantity - line.deliveryItems.reduce((sum, delivery) => sum + delivery.quantity, 0));
    if (line.materialId) openMaterial.set(line.materialId, (openMaterial.get(line.materialId) ?? 0) + remaining);
    if (line.productId) openProduct.set(line.productId, (openProduct.get(line.productId) ?? 0) + remaining);
  }
  const serializeOffers = (offers: typeof materials[number]["supplierCatalogItems"]) => offers.map((offer) => ({
    id: offer.id,
    supplierId: offer.supplier.id,
    supplierName: offer.supplier.name,
    name: offer.name,
    unit: offer.unit,
    isPreferred: offer.isPreferred,
    packQuantity: offer.packQuantity,
    minOrderQuantity: offer.minOrderQuantity,
    orderMultiple: offer.orderMultiple,
    leadTimeDays: offer.leadTimeDays,
    prices: offer.prices.map((price) => ({
      unitPriceCents: price.unitPriceCents,
      pricePerQuantity: price.pricePerQuantity,
      minimumQuantity: price.minimumQuantity,
      priceType: price.priceType,
      vatRate: price.vatRate,
      validFrom: price.validFrom.toISOString(),
      validTo: price.validTo?.toISOString() ?? null,
    })),
  }));
  const allItems: ReplenishmentItem[] = [
    ...materials.map((item) => ({
      key: `material:${item.id}`,
      kind: "material" as const,
      id: item.id,
      name: item.name,
      unit: item.unit,
      currentQuantity: materialStockMap.get(item.id) ?? 0,
      openOrderQuantity: openMaterial.get(item.id) ?? 0,
      minStock: item.minStock,
      targetStock: item.targetStock,
      offers: serializeOffers(item.supplierCatalogItems),
    })),
    ...products.map((item) => ({
      key: `product:${item.id}`,
      kind: "product" as const,
      id: item.id,
      name: item.name,
      unit: item.unit,
      currentQuantity: productStockMap.get(item.id) ?? 0,
      openOrderQuantity: openProduct.get(item.id) ?? 0,
      minStock: item.minStock,
      targetStock: item.targetStock,
      offers: serializeOffers(item.supplierCatalogItems),
    })),
  ];
  const lowItems = allItems.filter((item) => item.minStock > 0 && item.currentQuantity < item.minStock);

  return (
    <>
      <PageHeader title="Doobjednanie zásob" subtitle="Nízke stavy, otvorené objednávky, preferované ponuky a bezpečné koncepty">
        <Link href="/dodavatelia/objednavky" className={btnSecondary}>Objednávky</Link>
        <Link href="/sklad" className={btnSecondary}>Sklad</Link>
      </PageHeader>

      <ReplenishmentPlanner items={lowItems} />

      {canConfigure && <details className={`${card} mt-6`}>
        <summary className={`${cardHeader} cursor-pointer`}>Nastaviť minimálne a cieľové zásoby ({allItems.length})</summary>
        <div className="grid grid-cols-1 gap-3 p-5 lg:grid-cols-2">
          {allItems.map((item) => <div key={item.key} className="rounded-[10px] border border-stone-100 p-3">
            <div className="mb-2 text-sm font-semibold text-stone-900">{item.name} <span className="font-normal text-stone-400">· {item.kind === "material" ? "surovina" : "produkt"}</span></div>
            <StockTargetForm itemRef={item.key} minStock={item.minStock} targetStock={item.targetStock} unit={item.unit} />
          </div>)}
        </div>
      </details>}
    </>
  );
}
