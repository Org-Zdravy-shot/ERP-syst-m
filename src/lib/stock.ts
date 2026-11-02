import { prisma } from "./prisma";

export interface StockLevel {
  id: string;
  name: string;
  unit: string;
  minStock: number;
  quantity: number;
  isLow: boolean;
  hasRecordedStock: boolean;
  kind?: string;
}

/** Stav zásob surovín — SUM pohybov z ledgeru. */
export async function getMaterialStockLevels(): Promise<StockLevel[]> {
  const [materials, sums] = await Promise.all([
    prisma.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.stockMovement.groupBy({
      by: ["materialId"],
      where: { materialId: { not: null } },
      _sum: { quantity: true },
      _count: { _all: true },
    }),
  ]);
  const byId = new Map(sums.map((s) => [s.materialId, { quantity: s._sum.quantity ?? 0, count: s._count._all }]));
  return materials.map((m) => {
    const recorded = byId.get(m.id);
    const quantity = recorded?.quantity ?? 0;
    const hasRecordedStock = (recorded?.count ?? 0) > 0;
    return { id: m.id, name: m.name, unit: m.unit, kind: m.kind, minStock: m.minStock, quantity, hasRecordedStock, isLow: hasRecordedStock && quantity < m.minStock };
  });
}

/** Stav zásob hotových produktov — SUM pohybov z ledgeru. */
export async function getProductStockLevels(): Promise<StockLevel[]> {
  const [products, sums] = await Promise.all([
    prisma.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { productId: { not: null } },
      _sum: { quantity: true },
    }),
  ]);
  const byId = new Map(sums.map((s) => [s.productId, s._sum.quantity ?? 0]));
  return products.map((p) => {
    const quantity = byId.get(p.id) ?? 0;
    return { id: p.id, name: p.name, unit: p.unit, minStock: p.minStock, quantity, hasRecordedStock: true, isLow: quantity < p.minStock };
  });
}

/** Aktuálne množstvo jednej suroviny. */
export async function getMaterialQuantity(materialId: string): Promise<number> {
  const sum = await prisma.stockMovement.aggregate({
    where: { materialId },
    _sum: { quantity: true },
  });
  return sum._sum.quantity ?? 0;
}

/** Aktuálne množstvo jedného produktu. */
export async function getProductQuantity(productId: string): Promise<number> {
  const sum = await prisma.stockMovement.aggregate({
    where: { productId },
    _sum: { quantity: true },
  });
  return sum._sum.quantity ?? 0;
}

/** Položky pod minimálnou zásobou (suroviny + produkty). */
export async function getLowStockItems(): Promise<{ materials: StockLevel[]; products: StockLevel[] }> {
  const [materials, products] = await Promise.all([
    getMaterialStockLevels(),
    getProductStockLevels(),
  ]);
  return {
    materials: materials.filter((m) => m.isLow),
    products: products.filter((p) => p.isLow),
  };
}

export const MOVEMENT_TYPES = ["PRIJEM", "VYDAJ", "VYROBA", "SPOTREBA", "PREDAJ", "KOREKCIA"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  PRIJEM: "Príjem",
  VYDAJ: "Výdaj",
  VYROBA: "Výroba",
  SPOTREBA: "Spotreba vo výrobe",
  PREDAJ: "Predaj",
  KOREKCIA: "Korekcia",
};
