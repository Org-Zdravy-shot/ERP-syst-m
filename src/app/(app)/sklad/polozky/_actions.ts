"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { prisma } from "@/lib/prisma";
import { automaticPackagingMailReady } from "@/lib/suppliers/order-email";

export type MaterialFormState = { error?: string; success?: string };

function quantity(value: FormDataEntryValue | null): number {
  const raw = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  return raw === "" ? Number.NaN : Number(raw);
}

const schema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Názov je povinný.").max(255),
  unit: z.enum(["ks", "kg", "g", "l", "ml"]),
  kind: z.enum(["INGREDIENT", "PACKAGING"]),
  minStock: z.number().finite().nonnegative().max(1_000_000_000),
  targetStock: z.number().finite().nonnegative().max(1_000_000_000).nullable(),
  autoReorder: z.boolean(),
  autoOrderLegalEntity: z.enum(["SOLE_TRADER", "KURGI"]).nullable(),
}).superRefine((value, ctx) => {
  if (value.targetStock !== null && value.targetStock < value.minStock) {
    ctx.addIssue({ code: "custom", message: "Cieľová zásoba musí byť aspoň vo výške minima." });
  }
  if (value.autoReorder && (value.kind !== "PACKAGING" || value.minStock <= 0 || value.targetStock === null || !value.autoOrderLegalEntity)) {
    ctx.addIssue({ code: "custom", message: "Automatické objednávanie vyžaduje obal, kladné minimum, cieľovú zásobu a nákupný subjekt." });
  }
});

export async function saveMaterial(_previous: MaterialFormState, formData: FormData): Promise<MaterialFormState> {
  const user = await requireUser();
  if (!hasFinancePermission(user.role, "CONFIGURE")) return { error: "Na úpravu skladových položiek nemáte oprávnenie." };
  const targetRaw = String(formData.get("targetStock") ?? "").trim();
  const parsed = schema.safeParse({
    id: String(formData.get("id") ?? "").trim() || undefined,
    name: String(formData.get("name") ?? ""),
    unit: String(formData.get("unit") ?? ""),
    kind: String(formData.get("kind") ?? ""),
    minStock: quantity(formData.get("minStock")),
    targetStock: targetRaw ? quantity(formData.get("targetStock")) : null,
    autoReorder: formData.get("autoReorder") === "on",
    autoOrderLegalEntity: String(formData.get("autoOrderLegalEntity") ?? "") || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatná skladová položka." };
  const data = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const previous = data.id ? await tx.material.findUnique({ where: { id: data.id } }) : null;
      if (data.id && !previous) throw new Error("Skladová položka neexistuje.");
      if (previous && previous.unit !== data.unit) throw new Error("Jednotku existujúcej položky nemožno zmeniť, pretože skladové pohyby už môžu byť v pôvodnej jednotke.");
      if (data.autoReorder) {
        if (process.env.SUPPLIER_AUTO_ORDER_ENABLED !== "true") throw new Error("Automatické objednávanie obalov je dočasne vypnuté. Po sezóne ho musí najprv zapnúť správca systému.");
        if (!automaticPackagingMailReady()) throw new Error("Produkčný e-mail ešte nie je pripravený na automatické objednávanie.");
        if (!data.id) throw new Error("Najprv uložte obal a potom nastavte ponuku dodávateľa.");
        if (await tx.stockMovement.count({ where: { materialId: data.id } }) === 0) throw new Error("Najprv zapíšte počiatočný stav obalu cez skladový príjem.");
        const company = await tx.companyProfile.findFirst({ where: { isActive: true, legalEntity: data.autoOrderLegalEntity, validFrom: { lte: new Date() }, OR: [{ validTo: null }, { validTo: { gte: new Date() } }] } });
        if (!company) throw new Error("Pre vybraný nákupný subjekt chýba platný firemný profil.");
        const offers = await tx.supplierCatalogItem.findMany({
          where: { materialId: data.id, isActive: true, isPreferred: true, supplier: { isActive: true } },
          include: { supplier: { include: { contacts: { where: { isPrimary: true }, take: 1 } } }, prices: true },
        });
        if (offers.length !== 1) throw new Error("Pre automatické objednávanie vyberte práve jednu aktívnu preferovanú ponuku dodávateľa.");
        const offer = offers[0];
        if (![offer.supplier.contacts[0]?.email, offer.supplier.email].some((email) => z.email().safeParse(email).success)) throw new Error("Preferovaný dodávateľ nemá platnú e-mailovú adresu.");
        if (offer.unit !== data.unit) throw new Error("Jednotka ponuky dodávateľa sa musí zhodovať so skladovou jednotkou.");
        if (!offer.prices.some((price) => price.vatRate !== null && (price.priceType === "NET" || price.priceType === "GROSS") && price.validFrom <= new Date() && (!price.validTo || price.validTo >= new Date()))) {
          throw new Error("Preferovaná ponuka nemá aktívnu cenu s DPH.");
        }
      }
      const material = data.id
        ? await tx.material.update({ where: { id: data.id }, data: { name: data.name, kind: data.kind, minStock: data.minStock, targetStock: data.targetStock, autoReorder: data.autoReorder, autoOrderLegalEntity: data.autoOrderLegalEntity } })
        : await tx.material.create({ data: { name: data.name, unit: data.unit, kind: data.kind, minStock: data.minStock, targetStock: data.targetStock, autoOrderLegalEntity: data.autoOrderLegalEntity } });
      await tx.auditLog.create({ data: {
        actorId: user.userId, actorEmail: user.email,
        action: previous ? "MATERIAL_UPDATED" : "MATERIAL_CREATED",
        entityType: "Material", entityId: material.id,
        beforeData: previous ? { name: previous.name, unit: previous.unit, kind: previous.kind, minStock: previous.minStock, targetStock: previous.targetStock, autoReorder: previous.autoReorder, autoOrderLegalEntity: previous.autoOrderLegalEntity } : undefined,
        afterData: { name: material.name, unit: material.unit, kind: material.kind, minStock: material.minStock, targetStock: material.targetStock, autoReorder: material.autoReorder, autoOrderLegalEntity: material.autoOrderLegalEntity },
      } });
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Položku sa nepodarilo uložiť." };
  }
  revalidatePath("/sklad");
  revalidatePath("/sklad/pohyby");
  revalidatePath("/sklad/polozky");
  revalidatePath("/dodavatelia/doobjednanie");
  return { success: data.id ? "Položka bola upravená." : "Položka bola vytvorená. Počiatočný stav zapíšte cez skladový príjem." };
}
