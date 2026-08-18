"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { parseEurToCents } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  supplierAccountEntrySchema,
  supplierCatalogItemSchema,
  supplierPriceSchema,
  supplierReturnableMovementSchema,
  supplierReturnableTypeSchema,
} from "@/lib/zod-schemas";

export interface SupplierCommercialFormState {
  error?: string;
  success?: string;
}

function optionalText(formData: FormData, key: string): string | undefined {
  return String(formData.get(key) ?? "").trim() || undefined;
}

function parseNumber(value: FormDataEntryValue | null): number {
  return Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
}

function parseDate(value: FormDataEntryValue | null, endOfDay = false): Date | undefined {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const date = new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function requireFinanceAdministrator() {
  const user = await requireUser();
  if (!hasFinancePermission(user.role, "CONFIGURE")) {
    throw new Error("Túto operáciu môže vykonať iba finančný administrátor.");
  }
  return user;
}

function refreshSupplier(supplierId: string): void {
  revalidatePath("/dodavatelia");
  revalidatePath(`/dodavatelia/${supplierId}`);
  revalidatePath("/financie/faktury");
}

export async function createSupplierCatalogItem(
  supplierId: string,
  _previous: SupplierCommercialFormState,
  formData: FormData,
): Promise<SupplierCommercialFormState> {
  let user;
  try {
    user = await requireFinanceAdministrator();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Nemáte oprávnenie." };
  }
  const itemRef = String(formData.get("itemRef") ?? "service");
  const [kind, targetId] = itemRef.split(":");
  const parsed = supplierCatalogItemSchema.safeParse({
    materialId: kind === "material" ? targetId : undefined,
    productId: kind === "product" ? targetId : undefined,
    supplierSku: optionalText(formData, "supplierSku"),
    name: String(formData.get("name") ?? ""),
    unit: String(formData.get("unit") ?? ""),
    packQuantity: parseNumber(formData.get("packQuantity")),
    minOrderQuantity: parseNumber(formData.get("minOrderQuantity")),
    orderMultiple: parseNumber(formData.get("orderMultiple")),
    leadTimeDays: parseNumber(formData.get("leadTimeDays")),
    originCountry: optionalText(formData, "originCountry"),
    qualityNote: optionalText(formData, "qualityNote"),
    note: optionalText(formData, "note"),
    isPreferred: formData.get("isPreferred") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatná ponuka." };

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, isActive: true } });
  if (!supplier) return { error: "Dodávateľ neexistuje." };
  if (!supplier.isActive) return { error: "Neaktívnemu dodávateľovi nemožno pridať aktívnu ponuku." };
  if (parsed.data.materialId) {
    const material = await prisma.material.findUnique({ where: { id: parsed.data.materialId }, select: { id: true } });
    if (!material) return { error: "Vybraná surovina neexistuje." };
  }
  if (parsed.data.productId) {
    const product = await prisma.product.findUnique({ where: { id: parsed.data.productId }, select: { id: true } });
    if (!product) return { error: "Vybraný produkt neexistuje." };
  }

  const item = await prisma.$transaction(async (tx) => {
    if (parsed.data.isPreferred && parsed.data.materialId) {
      await tx.$queryRaw`SELECT "id" FROM "Material" WHERE "id" = ${parsed.data.materialId} FOR UPDATE`;
      await tx.supplierCatalogItem.updateMany({
        where: { materialId: parsed.data.materialId },
        data: { isPreferred: false },
      });
    }
    if (parsed.data.isPreferred && parsed.data.productId) {
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${parsed.data.productId} FOR UPDATE`;
      await tx.supplierCatalogItem.updateMany({
        where: { productId: parsed.data.productId },
        data: { isPreferred: false },
      });
    }
    const created = await tx.supplierCatalogItem.create({
      data: {
        supplierId,
        materialId: parsed.data.materialId ?? null,
        productId: parsed.data.productId ?? null,
        supplierSku: parsed.data.supplierSku ?? null,
        name: parsed.data.name,
        unit: parsed.data.unit,
        packQuantity: parsed.data.packQuantity,
        minOrderQuantity: parsed.data.minOrderQuantity,
        orderMultiple: parsed.data.orderMultiple,
        leadTimeDays: parsed.data.leadTimeDays,
        originCountry: parsed.data.originCountry ?? null,
        qualityNote: parsed.data.qualityNote ?? null,
        note: parsed.data.note ?? null,
        isPreferred: parsed.data.isPreferred,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: user.userId,
        actorEmail: user.email,
        action: "SUPPLIER_CATALOG_ITEM_CREATED",
        entityType: "SupplierCatalogItem",
        entityId: created.id,
        metadata: { supplierId },
        afterData: {
          name: created.name,
          materialId: created.materialId,
          productId: created.productId,
          isPreferred: created.isPreferred,
        },
      },
    });
    return created;
  });
  refreshSupplier(supplierId);
  return { success: `Ponuka „${item.name}“ bola pridaná.` };
}

export async function toggleSupplierCatalogItem(
  supplierId: string,
  catalogItemId: string,
): Promise<void> {
  const user = await requireFinanceAdministrator();
  const item = await prisma.supplierCatalogItem.findFirst({ where: { id: catalogItemId, supplierId } });
  if (!item) return;
  await prisma.$transaction([
    prisma.supplierCatalogItem.update({
      where: { id: item.id },
      data: { isActive: !item.isActive, ...(!item.isActive ? {} : { isPreferred: false }) },
    }),
    prisma.auditLog.create({
      data: {
        actorId: user.userId,
        actorEmail: user.email,
        action: item.isActive ? "SUPPLIER_CATALOG_ITEM_DEACTIVATED" : "SUPPLIER_CATALOG_ITEM_ACTIVATED",
        entityType: "SupplierCatalogItem",
        entityId: item.id,
        metadata: { supplierId },
      },
    }),
  ]);
  refreshSupplier(supplierId);
}

export async function createSupplierPrice(
  supplierId: string,
  catalogItemId: string,
  _previous: SupplierCommercialFormState,
  formData: FormData,
): Promise<SupplierCommercialFormState> {
  let user;
  try {
    user = await requireFinanceAdministrator();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Nemáte oprávnenie." };
  }
  let unitPriceCents: number;
  try {
    unitPriceCents = parseEurToCents(String(formData.get("unitPrice") ?? ""));
  } catch {
    return { error: "Neplatná cena." };
  }
  const validFrom = parseDate(formData.get("validFrom"));
  const validTo = parseDate(formData.get("validTo"), true);
  const parsed = supplierPriceSchema.safeParse({
    unitPriceCents,
    pricePerQuantity: parseNumber(formData.get("pricePerQuantity")),
    minimumQuantity: parseNumber(formData.get("minimumQuantity")),
    currency: "EUR",
    priceType: String(formData.get("priceType") ?? "NET"),
    vatRate: optionalText(formData, "vatRate") === undefined ? undefined : parseNumber(formData.get("vatRate")),
    validFrom,
    validTo,
    note: optionalText(formData, "note"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatná cena." };
  const item = await prisma.supplierCatalogItem.findFirst({
    where: { id: catalogItemId, supplierId },
    select: { id: true, name: true },
  });
  if (!item) return { error: "Ponuka neexistuje." };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SupplierCatalogItem" WHERE "id" = ${catalogItemId} FOR UPDATE`;
      const nextPrice = await tx.supplierPrice.findFirst({
        where: {
          catalogItemId,
          minimumQuantity: parsed.data.minimumQuantity,
          validFrom: { gt: parsed.data.validFrom },
        },
        orderBy: { validFrom: "asc" },
      });
      const latestAllowedTo = nextPrice ? new Date(nextPrice.validFrom.getTime() - 1) : null;
      if (latestAllowedTo && parsed.data.validTo && parsed.data.validTo > latestAllowedTo) {
        throw new Error("Cena sa prekrýva s neskoršou cenou rovnakého množstevného pásma.");
      }
      await tx.supplierPrice.updateMany({
        where: {
          catalogItemId,
          minimumQuantity: parsed.data.minimumQuantity,
          validFrom: { lt: parsed.data.validFrom },
          OR: [{ validTo: null }, { validTo: { gte: parsed.data.validFrom } }],
        },
        data: { validTo: new Date(parsed.data.validFrom.getTime() - 1) },
      });
      const price = await tx.supplierPrice.create({
        data: {
          catalogItemId,
          unitPriceCents: parsed.data.unitPriceCents,
          pricePerQuantity: parsed.data.pricePerQuantity,
          minimumQuantity: parsed.data.minimumQuantity,
          currency: parsed.data.currency,
          priceType: parsed.data.priceType,
          vatRate: parsed.data.vatRate ?? null,
          validFrom: parsed.data.validFrom,
          validTo: parsed.data.validTo ?? latestAllowedTo,
          note: parsed.data.note ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "SUPPLIER_PRICE_CREATED",
          entityType: "SupplierPrice",
          entityId: price.id,
          metadata: { supplierId, catalogItemId },
          afterData: {
            unitPriceCents: price.unitPriceCents,
            minimumQuantity: price.minimumQuantity,
            priceType: price.priceType,
            validFrom: price.validFrom.toISOString(),
            validTo: price.validTo?.toISOString() ?? null,
          },
        },
      });
    });
  } catch (error) {
    return { error: error instanceof Error && error.message.startsWith("Cena sa prekrýva") ? error.message : "Cenu sa nepodarilo uložiť. Skontrolujte, či už rovnaká platnosť neexistuje." };
  }
  refreshSupplier(supplierId);
  return { success: `Nová cena pre „${item.name}“ bola uložená.` };
}

export async function createSupplierReturnableType(
  supplierId: string,
  _previous: SupplierCommercialFormState,
  formData: FormData,
): Promise<SupplierCommercialFormState> {
  const user = await requireUser();
  let depositCents: number | undefined;
  const deposit = optionalText(formData, "deposit");
  if (deposit && !hasFinancePermission(user.role, "CONFIGURE")) {
    return { error: "Depozit môže nastaviť iba finančný administrátor." };
  }
  if (deposit) {
    try {
      depositCents = parseEurToCents(deposit);
    } catch {
      return { error: "Neplatný depozit." };
    }
  }
  const parsed = supplierReturnableTypeSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    unit: String(formData.get("unit") ?? "ks"),
    owner: String(formData.get("owner") ?? "SUPPLIER"),
    depositCents,
    expectedReturnDays: optionalText(formData, "expectedReturnDays") === undefined
      ? undefined
      : parseNumber(formData.get("expectedReturnDays")),
    reminderNote: optionalText(formData, "reminderNote"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatný vratný obal." };
  try {
    await prisma.$transaction(async (tx) => {
      const type = await tx.supplierReturnableType.create({
        data: {
          supplierId,
          name: parsed.data.name,
          unit: parsed.data.unit,
          owner: parsed.data.owner,
          depositCents: parsed.data.depositCents ?? null,
          expectedReturnDays: parsed.data.expectedReturnDays ?? null,
          reminderNote: parsed.data.reminderNote ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "SUPPLIER_RETURNABLE_TYPE_CREATED",
          entityType: "SupplierReturnableType",
          entityId: type.id,
          metadata: { supplierId },
          afterData: { name: type.name, owner: type.owner, depositCents: type.depositCents },
        },
      });
    });
  } catch {
    return { error: "Vratný obal s týmto názvom už môže existovať." };
  }
  refreshSupplier(supplierId);
  return { success: "Typ vratného obalu bol pridaný." };
}

export async function createSupplierReturnableMovement(
  supplierId: string,
  returnableTypeId: string,
  _previous: SupplierCommercialFormState,
  formData: FormData,
): Promise<SupplierCommercialFormState> {
  const user = await requireUser();
  const direction = String(formData.get("direction") ?? "INCREASE");
  if (direction !== "INCREASE" && direction !== "DECREASE") return { error: "Neplatný smer pohybu." };
  const absoluteQuantity = Math.abs(parseNumber(formData.get("quantity")));
  const quantity = direction === "DECREASE" ? -absoluteQuantity : absoluteQuantity;
  const parsed = supplierReturnableMovementSchema.safeParse({
    quantity,
    occurredAt: parseDate(formData.get("occurredAt")),
    dueDate: parseDate(formData.get("dueDate"), true),
    reference: optionalText(formData, "reference"),
    note: optionalText(formData, "note"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatný pohyb." };
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SupplierReturnableType" WHERE "id" = ${returnableTypeId} FOR UPDATE`;
      const type = await tx.supplierReturnableType.findFirst({
        where: { id: returnableTypeId, supplierId, isActive: true },
        include: { movements: { select: { quantity: true } } },
      });
      if (!type) throw new Error("RETURNABLE:Vratný obal neexistuje.");
      const balance = type.movements.reduce((sum, movement) => sum + movement.quantity, 0);
      if (balance + parsed.data.quantity < -1e-9) {
        throw new Error(`RETURNABLE:Nemožno vrátiť viac než aktuálny zostatok ${balance} ${type.unit}.`);
      }
      const movement = await tx.supplierReturnableMovement.create({
        data: {
          returnableTypeId,
          quantity: parsed.data.quantity,
          occurredAt: parsed.data.occurredAt,
          dueDate: parsed.data.dueDate ?? null,
          reference: parsed.data.reference ?? null,
          note: parsed.data.note ?? null,
          createdById: user.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "SUPPLIER_RETURNABLE_MOVEMENT_CREATED",
          entityType: "SupplierReturnableMovement",
          entityId: movement.id,
          metadata: { supplierId, returnableTypeId },
          afterData: { quantity: movement.quantity, occurredAt: movement.occurredAt.toISOString() },
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("RETURNABLE:")) {
      return { error: error.message.slice("RETURNABLE:".length) };
    }
    return { error: "Pohyb vratného obalu sa nepodarilo uložiť." };
  }
  refreshSupplier(supplierId);
  return { success: "Pohyb vratného obalu bol uložený." };
}

export async function createSupplierAccountEntry(
  supplierId: string,
  _previous: SupplierCommercialFormState,
  formData: FormData,
): Promise<SupplierCommercialFormState> {
  let user;
  try {
    user = await requireFinanceAdministrator();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Nemáte oprávnenie." };
  }
  let amountCents: number;
  try {
    amountCents = Math.abs(parseEurToCents(String(formData.get("amount") ?? "")));
  } catch {
    return { error: "Neplatná suma." };
  }
  const direction = String(formData.get("direction") ?? "WE_OWE");
  if (direction !== "WE_OWE" && direction !== "THEY_OWE") return { error: "Neplatný smer záväzku." };
  if (direction === "THEY_OWE") amountCents *= -1;
  const parsed = supplierAccountEntrySchema.safeParse({
    type: String(formData.get("type") ?? "OTHER"),
    amountCents,
    occurredAt: parseDate(formData.get("occurredAt")),
    dueDate: parseDate(formData.get("dueDate"), true),
    reference: optionalText(formData, "reference"),
    note: optionalText(formData, "note"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatný finančný pohyb." };
  try {
    await prisma.$transaction(async (tx) => {
      const entry = await tx.supplierAccountEntry.create({
        data: {
          supplierId,
          type: parsed.data.type,
          amountCents: parsed.data.amountCents,
          occurredAt: parsed.data.occurredAt,
          dueDate: parsed.data.dueDate ?? null,
          reference: parsed.data.reference ?? null,
          note: parsed.data.note ?? null,
          createdById: user.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "SUPPLIER_ACCOUNT_ENTRY_CREATED",
          entityType: "SupplierAccountEntry",
          entityId: entry.id,
          metadata: { supplierId },
          afterData: { type: entry.type, amountCents: entry.amountCents, occurredAt: entry.occurredAt.toISOString() },
        },
      });
    });
  } catch {
    return { error: "Finančný pohyb sa nepodarilo uložiť. Skontrolujte dodávateľa a údaje." };
  }
  refreshSupplier(supplierId);
  return { success: "Finančný pohyb bol uložený." };
}

export async function linkSupplierInvoice(
  supplierId: string,
  _previous: SupplierCommercialFormState,
  formData: FormData,
): Promise<SupplierCommercialFormState> {
  let user;
  try {
    user = await requireFinanceAdministrator();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Nemáte oprávnenie." };
  }
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const [supplier, invoice] = await Promise.all([
    prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } }),
    prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, direction: true, supplierId: true } }),
  ]);
  if (!supplier) return { error: "Dodávateľ neexistuje." };
  if (!invoice || invoice.direction !== "PRIJATA") return { error: "Vybraná prijatá faktúra neexistuje." };
  if (invoice.supplierId && invoice.supplierId !== supplierId) return { error: "Faktúra je už priradená inému dodávateľovi." };
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.updateMany({
        where: { id: invoice.id, direction: "PRIJATA", OR: [{ supplierId: null }, { supplierId }] },
        data: { supplierId },
      });
      if (updated.count !== 1) throw new Error("INVOICE_ALREADY_LINKED");
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "SUPPLIER_INVOICE_LINKED",
          entityType: "Invoice",
          entityId: invoice.id,
          beforeData: { supplierId: invoice.supplierId },
          afterData: { supplierId },
          metadata: { supplierId },
        },
      });
    });
  } catch {
    return { error: "Faktúru medzitým priradil iný používateľ. Obnovte stránku." };
  }
  refreshSupplier(supplierId);
  return { success: `Faktúra bola priradená dodávateľovi ${supplier.name}.` };
}

export async function unlinkSupplierInvoice(supplierId: string, invoiceId: string): Promise<void> {
  const user = await requireFinanceAdministrator();
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, supplierId, direction: "PRIJATA" } });
  if (!invoice) return;
  await prisma.$transaction([
    prisma.invoice.update({ where: { id: invoice.id }, data: { supplierId: null } }),
    prisma.auditLog.create({
      data: {
        actorId: user.userId,
        actorEmail: user.email,
        action: "SUPPLIER_INVOICE_UNLINKED",
        entityType: "Invoice",
        entityId: invoice.id,
        beforeData: { supplierId },
        afterData: { supplierId: null },
        metadata: { supplierId },
      },
    }),
  ]);
  refreshSupplier(supplierId);
}
