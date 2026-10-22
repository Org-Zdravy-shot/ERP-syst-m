"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatQty } from "@/lib/format";
import { nextNumber } from "@/lib/invoicing";

export interface BatchFormState {
  error?: string;
}

function parseQty(value: string): number {
  const parsed = Number.parseFloat(value.replace(/\s/g, "").replace(",", "."));
  return Number.isNaN(parsed) ? NaN : parsed;
}

/** Nová šarža (PLANNED). Exspirácia sa dopočíta z trvanlivosti produktu, ak nie je zadaná. */
export async function createBatch(_prev: BatchFormState, formData: FormData): Promise<BatchFormState> {
  await requireUser();

  const productId = String(formData.get("productId") ?? "");
  const qty = Number.parseInt(String(formData.get("producedQty") ?? ""), 10);
  const productionDateRaw = String(formData.get("productionDate") ?? "");
  const expiryDateRaw = String(formData.get("expiryDate") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!productId) return { error: "Vyberte produkt." };
  if (!Number.isInteger(qty) || qty <= 0) return { error: "Zadajte kladný počet kusov." };
  const productionDate = productionDateRaw ? new Date(productionDateRaw) : new Date();
  if (Number.isNaN(productionDate.getTime())) return { error: "Neplatný dátum výroby." };

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return { error: "Produkt neexistuje." };

  const expiryDate = expiryDateRaw
    ? new Date(expiryDateRaw)
    : new Date(productionDate.getTime() + product.shelfLifeDays * 24 * 3600 * 1000);
  if (Number.isNaN(expiryDate.getTime())) return { error: "Neplatný dátum exspirácie." };
  if (expiryDate <= productionDate) return { error: "Exspirácia musí byť po dátume výroby." };

  await prisma.$transaction(async (tx) => {
    const batchNumber = await nextNumber(tx, "SARZA", productionDate.getFullYear());
    await tx.productionBatch.create({
      data: { batchNumber, productId, producedQty: qty, productionDate, expiryDate, note },
    });
  });

  revalidatePath("/vyroba");
  redirect("/vyroba");
}

/**
 * Dokončenie šarže — jedna transakcia:
 * kontrola zásob → −SPOTREBA surovín podľa receptúry (škálovanej na producedQty) → +VYROBA produktu.
 */
export async function completeBatch(_prev: BatchFormState, formData: FormData): Promise<BatchFormState> {
  const user = await requireUser();
  const batchId = String(formData.get("batchId") ?? "");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ProductionBatch" WHERE id = ${batchId} FOR UPDATE`;
      const batch = await tx.productionBatch.findUnique({
        where: { id: batchId },
        include: {
          product: { include: { recipe: { include: { items: { include: { material: true } } } } } },
        },
      });
      if (!batch) throw new Error("Šarža neexistuje.");
      if (batch.status !== "PLANNED") throw new Error("Šarža už bola dokončená alebo zrušená.");

      const recipe = batch.product.recipe;
      if (!recipe || recipe.items.length === 0) {
        throw new Error(`Produkt ${batch.product.name} nemá receptúru — najprv ju vytvorte.`);
      }

      const scale = batch.producedQty / recipe.batchSize;

      for (const materialId of [...new Set(recipe.items.map((item) => item.materialId))].sort()) {
        await tx.$queryRaw`SELECT id FROM "Material" WHERE id = ${materialId} FOR UPDATE`;
      }

      // Kontrola zásob všetkých surovín pred prvým zápisom
      for (const item of recipe.items) {
        const needed = item.quantity * scale;
        const sum = await tx.stockMovement.aggregate({
          where: { materialId: item.materialId },
          _sum: { quantity: true },
        });
        const current = sum._sum.quantity ?? 0;
        if (current < needed) {
          throw new Error(
            `Nedostatok suroviny ${item.material.name}: potrebné ${formatQty(needed, item.material.unit)}, na sklade ${formatQty(current, item.material.unit)}.`,
          );
        }
      }

      for (const item of recipe.items) {
        await tx.stockMovement.create({
          data: {
            type: "SPOTREBA",
            materialId: item.materialId,
            quantity: -(item.quantity * scale),
            batchId: batch.id,
            createdById: user.userId,
          },
        });
      }
      await tx.stockMovement.create({
        data: {
          type: "VYROBA",
          productId: batch.productId,
          quantity: batch.producedQty,
          batchId: batch.id,
          createdById: user.userId,
        },
      });
      await tx.productionBatch.update({ where: { id: batchId }, data: { status: "DONE" } });
    }, { timeout: 15_000 });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Šaržu sa nepodarilo dokončiť." };
  }

  revalidatePath("/vyroba");
  revalidatePath("/sklad");
  revalidatePath("/sklad/pohyby");
  return {};
}

export async function cancelBatch(formData: FormData) {
  await requireUser();
  const batchId = String(formData.get("batchId") ?? "");
  await prisma.productionBatch.updateMany({
    where: { id: batchId, status: "PLANNED" },
    data: { status: "CANCELLED" },
  });
  revalidatePath("/vyroba");
}

// ---------- Receptúry ----------

export async function createRecipe(formData: FormData) {
  await requireUser();
  const productId = String(formData.get("productId") ?? "");
  const existing = await prisma.recipe.findUnique({ where: { productId } });
  if (existing) redirect(`/vyroba/receptury/${existing.id}`);
  const recipe = await prisma.recipe.create({ data: { productId, batchSize: 100 } });
  revalidatePath("/vyroba/receptury");
  redirect(`/vyroba/receptury/${recipe.id}`);
}

export async function updateRecipe(formData: FormData) {
  await requireUser();
  const recipeId = String(formData.get("recipeId") ?? "");
  const batchSize = Number.parseInt(String(formData.get("batchSize") ?? ""), 10);
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    redirect(`/vyroba/receptury/${recipeId}?chyba=${encodeURIComponent("Veľkosť dávky musí byť kladné číslo.")}`);
  }
  await prisma.recipe.update({ where: { id: recipeId }, data: { batchSize, note } });
  revalidatePath(`/vyroba/receptury/${recipeId}`);
  redirect(`/vyroba/receptury/${recipeId}`);
}

export async function upsertRecipeItem(formData: FormData) {
  await requireUser();
  const recipeId = String(formData.get("recipeId") ?? "");
  const materialId = String(formData.get("materialId") ?? "");
  const quantity = parseQty(String(formData.get("quantity") ?? ""));
  if (!materialId || Number.isNaN(quantity) || quantity <= 0) {
    redirect(`/vyroba/receptury/${recipeId}?chyba=${encodeURIComponent("Zadajte surovinu a kladné množstvo.")}`);
  }
  await prisma.recipeItem.upsert({
    where: { recipeId_materialId: { recipeId, materialId } },
    create: { recipeId, materialId, quantity },
    update: { quantity },
  });
  revalidatePath(`/vyroba/receptury/${recipeId}`);
  redirect(`/vyroba/receptury/${recipeId}`);
}

export async function deleteRecipeItem(formData: FormData) {
  await requireUser();
  const itemId = String(formData.get("itemId") ?? "");
  const recipeId = String(formData.get("recipeId") ?? "");
  await prisma.recipeItem.delete({ where: { id: itemId } });
  revalidatePath(`/vyroba/receptury/${recipeId}`);
  redirect(`/vyroba/receptury/${recipeId}`);
}
