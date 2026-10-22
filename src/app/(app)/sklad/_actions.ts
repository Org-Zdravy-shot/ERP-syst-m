"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatQty, parseEurToCents } from "@/lib/format";
import { allocateProductStock, InsufficientProductStockError } from "@/lib/stock-allocation";

export interface MovementFormState {
  error?: string;
}

/** "1,5" / "1.5" → 1.5 */
function parseQty(value: string): number {
  const parsed = Number.parseFloat(value.replace(/\s/g, "").replace(",", "."));
  return Number.isNaN(parsed) ? NaN : parsed;
}

/**
 * Ručný skladový pohyb: PRIJEM (+), VYDAJ (−), KOREKCIA (so znamienkom).
 * Pohyby VYROBA/SPOTREBA/PREDAJ vznikajú len v moduloch Výroba a Objednávky.
 */
export async function createStockMovement(
  _prev: MovementFormState,
  formData: FormData,
): Promise<MovementFormState> {
  const user = await requireUser();

  const type = String(formData.get("type") ?? "");
  const itemRef = String(formData.get("itemRef") ?? "");
  const qtyRaw = String(formData.get("quantity") ?? "");
  const priceRaw = String(formData.get("unitPrice") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  const batchId = String(formData.get("batchId") ?? "").trim() || null;

  if (!["PRIJEM", "VYDAJ", "KOREKCIA"].includes(type)) {
    return { error: "Neplatný typ pohybu." };
  }
  const [kind, itemId] = itemRef.split(":");
  if ((kind !== "m" && kind !== "p") || !itemId) {
    return { error: "Vyberte surovinu alebo produkt." };
  }

  const qty = parseQty(qtyRaw);
  if (Number.isNaN(qty) || qty === 0) {
    return { error: "Zadajte platné množstvo (nesmie byť 0)." };
  }
  if (qty < 0 && type !== "KOREKCIA") {
    return { error: "Záporné množstvo je povolené len pri korekcii." };
  }

  // PRIJEM: +, VYDAJ: −, KOREKCIA: so znamienkom ako zadané
  const signedQty = type === "VYDAJ" ? -Math.abs(qty) : qty;

  let unitPriceCents: number | null = null;
  if (priceRaw) {
    try {
      unitPriceCents = parseEurToCents(priceRaw);
    } catch {
      return { error: "Neplatná jednotková cena." };
    }
  }

  const isMaterial = kind === "m";
  if (isMaterial && batchId) return { error: "Šaržu možno zvoliť len pre produkt." };
  const where = isMaterial ? { materialId: itemId } : { productId: itemId };

  try {
    await prisma.$transaction(async (tx) => {
      if (isMaterial) await tx.$queryRaw`SELECT id FROM "Material" WHERE id = ${itemId} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${itemId} FOR UPDATE`;

      let allocations: Array<{ batchId: string | null; quantity: number }> = [];
      if (batchId) {
        const batch = await tx.productionBatch.findFirst({
          where: { id: batchId, productId: itemId, status: "DONE" },
        });
        if (!batch) throw new Error("Vybraná šarža nepatrí k produktu alebo nie je dokončená.");
      }
      // Kontrola: stav nesmie klesnúť pod nulu
      if (signedQty < 0) {
        const sum = await tx.stockMovement.aggregate({ where, _sum: { quantity: true } });
        const current = sum._sum.quantity ?? 0;
        if (current + signedQty < -1e-9) {
          throw new Error(
            `Nedostatočná zásoba: na sklade je ${formatQty(current)}, požadovaný výdaj ${formatQty(Math.abs(signedQty))}.`,
          );
        }
        if (!isMaterial) {
          if (batchId) {
            const batchSum = await tx.stockMovement.aggregate({
              where: { productId: itemId, batchId }, _sum: { quantity: true },
            });
            const batchQuantity = batchSum._sum.quantity ?? 0;
            if (batchQuantity + signedQty < -1e-9) throw new Error(`V šarži je len ${formatQty(batchQuantity)} ks.`);
            allocations = [{ batchId, quantity: Math.abs(signedQty) }];
          } else {
            const [balances, batches] = await Promise.all([
              tx.stockMovement.groupBy({ by: ["batchId"], where: { productId: itemId }, _sum: { quantity: true } }),
              tx.productionBatch.findMany({ where: { productId: itemId, status: "DONE" }, select: { id: true, expiryDate: true } }),
            ]);
            const dateParts = new Intl.DateTimeFormat("en-CA", {
              timeZone: "Europe/Bratislava", year: "numeric", month: "2-digit", day: "2-digit",
            }).formatToParts(new Date());
            const dayPart = (part: string) => Number(dateParts.find((value) => value.type === part)?.value);
            const today = new Date(Date.UTC(dayPart("year"), dayPart("month") - 1, dayPart("day")));
            try {
              allocations = allocateProductStock(
                batches.map((batch) => ({
                  batchId: batch.id, expiryDate: batch.expiryDate,
                  quantity: balances.find((balance) => balance.batchId === batch.id)?._sum.quantity ?? 0,
                })),
                balances.find((balance) => balance.batchId === null)?._sum.quantity ?? 0,
                Math.abs(signedQty), today,
              );
            } catch (error) {
              if (error instanceof InsufficientProductStockError) {
                throw new Error(`Použiteľná zásoba je len ${formatQty(error.available)}. Exspirovanú šaržu možno upraviť jej výslovným výberom.`);
              }
              throw error;
            }
          }
        }
      }

      const entries = allocations.length ? allocations.map((allocation) => ({
        quantity: -allocation.quantity, batchId: allocation.batchId,
      })) : [{ quantity: signedQty, batchId }];
      for (const entry of entries) {
        await tx.stockMovement.create({
          data: {
            type,
            ...(isMaterial ? { materialId: itemId } : { productId: itemId, batchId: entry.batchId }),
            quantity: entry.quantity,
            unitPriceCents,
            note: note ?? (!isMaterial && !entry.batchId ? "Šarža neurčená" : null),
            createdById: user.userId,
          },
        });
      }

      // Príjem suroviny s cenou aktualizuje poslednú nákupnú cenu (vstup pre marže)
      if (isMaterial && type === "PRIJEM" && unitPriceCents !== null) {
        await tx.material.update({ where: { id: itemId }, data: { lastPriceCents: unitPriceCents } });
      }
    }, { timeout: 15_000 });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Pohyb sa nepodarilo uložiť." };
  }

  revalidatePath("/sklad");
  revalidatePath("/sklad/pohyby");
  revalidatePath("/objednavky");
  redirect("/sklad/pohyby");
}
