"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, type AuthenticatedUser } from "@/lib/auth";
import { hasFinancePermission, type FinancePermission } from "@/lib/finance/permissions";
import { parseEurToCents } from "@/lib/format";
import { nextNumber } from "@/lib/invoicing";
import { prisma } from "@/lib/prisma";
import {
  assertSupplierOrderTransition,
  calculateSupplierOrderTotals,
  deriveSupplierOrderReceiptStatus,
  recommendedOrderQuantity,
  selectActiveSupplierPrice,
  SupplierDomainError,
  type SupplierOrderStatus,
} from "@/lib/suppliers/domain";
import { supplierOrderStatusLabels } from "@/lib/zod-schemas";

export interface SupplierOrderFormState {
  error?: string;
  success?: string;
}

const replenishmentLineSchema = z.object({
  kind: z.enum(["material", "product"]),
  itemId: z.string().min(1),
  catalogItemId: z.string().min(1),
  quantity: z.number().positive().max(1_000_000_000),
});

class SupplierOrderActionError extends Error {}

const lineSchema = z.object({
  catalogItemId: z.string().min(1),
  quantity: z.number().positive().max(1_000_000_000),
});

const orderSchema = z.object({
  supplierId: z.string().min(1, "Vyberte dodávateľa."),
  requestedDeliveryDate: z.date().optional(),
  shippingCents: z.number().int().nonnegative().safe(),
  discountCents: z.number().int().nonnegative().safe(),
  note: z.string().trim().max(5_000).optional(),
  items: z.array(lineSchema).min(1, "Pridajte aspoň jednu položku.").max(100),
});

const receiptLineSchema = z.object({
  orderItemId: z.string().min(1),
  quantity: z.number().nonnegative().max(1_000_000_000),
});

const receiptReturnableSchema = z.object({
  returnableTypeId: z.string().min(1),
  quantity: z.number().nonnegative().max(1_000_000_000),
  dueDate: z.preprocess(
    (value) => typeof value === "string" && value ? new Date(`${value}T23:59:59.999Z`) : value,
    z.date().optional(),
  ),
});

type Tx = Prisma.TransactionClient;

function optionalText(formData: FormData, key: string): string | undefined {
  return String(formData.get(key) ?? "").trim() || undefined;
}

function parseDate(value: FormDataEntryValue | null, endOfDay = false): Date | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const date = new Date(`${raw}T${endOfDay ? "23:59:59.999" : "12:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseJson(value: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(String(value ?? "[]"));
  } catch {
    return null;
  }
}

function parseOptionalMoney(formData: FormData, key: string): number {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return 0;
  return parseEurToCents(raw);
}

function parseOrderForm(formData: FormData) {
  let shippingCents: number;
  let discountCents: number;
  try {
    shippingCents = parseOptionalMoney(formData, "shipping");
    discountCents = parseOptionalMoney(formData, "discount");
  } catch {
    return { success: false as const, error: "Doprava alebo zľava nemá platný formát sumy." };
  }
  const requestedDeliveryRaw = optionalText(formData, "requestedDeliveryDate");
  const requestedDeliveryDate = parseDate(formData.get("requestedDeliveryDate"));
  if (requestedDeliveryRaw && !requestedDeliveryDate) {
    return { success: false as const, error: "Požadovaný termín dodania nie je platný." };
  }
  const parsed = orderSchema.safeParse({
    supplierId: String(formData.get("supplierId") ?? ""),
    requestedDeliveryDate,
    shippingCents,
    discountCents,
    note: optionalText(formData, "note"),
    items: parseJson(formData.get("items")),
  });
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? "Neplatná objednávka." };
  }
  if (new Set(parsed.data.items.map((item) => item.catalogItemId)).size !== parsed.data.items.length) {
    return { success: false as const, error: "Každá ponuka môže byť v objednávke iba raz." };
  }
  return { success: true as const, data: parsed.data };
}

async function requireFinance(permission: FinancePermission): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (!hasFinancePermission(user.role, permission)) {
    throw new SupplierOrderActionError("Na túto operáciu nemáte finančné oprávnenie.");
  }
  return user;
}

function isQuantityStep(quantity: number, step: number): boolean {
  const ratio = quantity / step;
  return Math.abs(ratio - Math.round(ratio)) <= 1e-8;
}

async function resolveOrderLines(
  tx: Tx,
  supplierId: string,
  inputs: Array<z.infer<typeof lineSchema>>,
  at: Date,
) {
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier || !supplier.isActive) throw new SupplierOrderActionError("Vybraný dodávateľ neexistuje alebo je neaktívny.");
  const offers = await tx.supplierCatalogItem.findMany({
    where: { id: { in: inputs.map((item) => item.catalogItemId) }, supplierId, isActive: true },
    include: { prices: true },
  });
  if (offers.length !== inputs.length) {
    throw new SupplierOrderActionError("Niektorá ponuka neexistuje, je neaktívna alebo patrí inému dodávateľovi.");
  }
  const byId = new Map(offers.map((offer) => [offer.id, offer]));
  const lines = inputs.map((input, index) => {
    const offer = byId.get(input.catalogItemId);
    if (!offer) throw new SupplierOrderActionError(`Ponuka na riadku ${index + 1} neexistuje.`);
    if (input.quantity + 1e-9 < offer.minOrderQuantity) {
      throw new SupplierOrderActionError(`„${offer.name}“ má minimálny odber ${offer.minOrderQuantity} ${offer.unit}.`);
    }
    if (!isQuantityStep(input.quantity, offer.packQuantity) || !isQuantityStep(input.quantity, offer.orderMultiple)) {
      throw new SupplierOrderActionError(
        `Množstvo „${offer.name}“ musí rešpektovať balenie ${offer.packQuantity} a objednávkový krok ${offer.orderMultiple} ${offer.unit}.`,
      );
    }
    const price = selectActiveSupplierPrice(offer.prices, input.quantity, at);
    if (!price) throw new SupplierOrderActionError(`Pre „${offer.name}“ chýba platná cena pre zadané množstvo.`);
    if (price.priceType !== "NET" && price.priceType !== "GROSS") {
      throw new SupplierOrderActionError(`Cena „${offer.name}“ má neplatný typ ceny.`);
    }
    const priceType: "NET" | "GROSS" = price.priceType;
    if (price.vatRate === null) {
      throw new SupplierOrderActionError(`Pri cene „${offer.name}“ doplňte sadzbu DPH; pre neplatiteľa použite 0 %.`);
    }
    return {
      catalogItemId: offer.id,
      materialId: offer.materialId,
      productId: offer.productId,
      lineNumber: index + 1,
      description: offer.name,
      supplierSku: offer.supplierSku,
      quantity: input.quantity,
      unit: offer.unit,
      unitPriceCents: price.unitPriceCents,
      pricePerQuantity: price.pricePerQuantity,
      priceType,
      vatRate: price.vatRate,
    };
  });
  return { supplier, lines };
}

function refreshOrder(orderId?: string, supplierId?: string): void {
  revalidatePath("/");
  revalidatePath("/dodavatelia");
  revalidatePath("/dodavatelia/objednavky");
  revalidatePath("/dodavatelia/doobjednanie");
  revalidatePath("/sklad");
  revalidatePath("/sklad/pohyby");
  if (orderId) revalidatePath(`/dodavatelia/objednavky/${orderId}`);
  if (supplierId) revalidatePath(`/dodavatelia/${supplierId}`);
}

export async function createSupplierOrder(
  _previous: SupplierOrderFormState,
  formData: FormData,
): Promise<SupplierOrderFormState> {
  let user: AuthenticatedUser;
  try {
    user = await requireFinance("CREATE_DRAFT");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Nemáte oprávnenie." };
  }
  const parsed = parseOrderForm(formData);
  if (!parsed.success) return { error: parsed.error };
  let order: { id: string };
  try {
    order = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const { lines } = await resolveOrderLines(tx, parsed.data.supplierId, parsed.data.items, now);
      calculateSupplierOrderTotals(lines, parsed.data.shippingCents, parsed.data.discountCents);
      const orderNumber = await nextNumber(tx, "NAKUP", now.getFullYear());
      const created = await tx.supplierOrder.create({
        data: {
          orderNumber,
          supplierId: parsed.data.supplierId,
          orderDate: now,
          requestedDeliveryDate: parsed.data.requestedDeliveryDate ?? null,
          shippingCents: parsed.data.shippingCents,
          discountCents: parsed.data.discountCents,
          note: parsed.data.note ?? null,
          createdById: user.userId,
          items: { create: lines },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "SUPPLIER_ORDER_CREATED",
          entityType: "SupplierOrder",
          entityId: created.id,
          metadata: { supplierId: parsed.data.supplierId },
          afterData: { orderNumber, itemCount: lines.length, status: "DRAFT" },
        },
      });
      return created;
    });
  } catch (error) {
    if (error instanceof SupplierOrderActionError || error instanceof SupplierDomainError) return { error: error.message };
    return { error: "Koncept objednávky sa nepodarilo vytvoriť." };
  }
  refreshOrder(order.id, parsed.data.supplierId);
  redirect(`/dodavatelia/objednavky/${order.id}`);
}

export async function updateSupplierOrder(
  orderId: string,
  _previous: SupplierOrderFormState,
  formData: FormData,
): Promise<SupplierOrderFormState> {
  let user: AuthenticatedUser;
  try {
    user = await requireFinance("CREATE_DRAFT");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Nemáte oprávnenie." };
  }
  const parsed = parseOrderForm(formData);
  if (!parsed.success) return { error: parsed.error };
  let previousSupplierId: string;
  try {
    previousSupplierId = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SupplierOrder" WHERE "id" = ${orderId} FOR UPDATE`;
      const existing = await tx.supplierOrder.findUnique({ where: { id: orderId } });
      if (!existing) throw new SupplierOrderActionError("Objednávka neexistuje.");
      if (existing.status !== "DRAFT") throw new SupplierOrderActionError("Upravovať možno iba koncept objednávky.");
      const { lines } = await resolveOrderLines(tx, parsed.data.supplierId, parsed.data.items, new Date());
      calculateSupplierOrderTotals(lines, parsed.data.shippingCents, parsed.data.discountCents);
      await tx.supplierOrderItem.deleteMany({ where: { supplierOrderId: orderId } });
      await tx.supplierOrder.update({
        where: { id: orderId },
        data: {
          supplierId: parsed.data.supplierId,
          requestedDeliveryDate: parsed.data.requestedDeliveryDate ?? null,
          shippingCents: parsed.data.shippingCents,
          discountCents: parsed.data.discountCents,
          note: parsed.data.note ?? null,
          items: { create: lines },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "SUPPLIER_ORDER_UPDATED",
          entityType: "SupplierOrder",
          entityId: orderId,
          metadata: { supplierId: parsed.data.supplierId },
          beforeData: { supplierId: existing.supplierId },
          afterData: { supplierId: parsed.data.supplierId, itemCount: lines.length },
        },
      });
      return existing.supplierId;
    });
  } catch (error) {
    if (error instanceof SupplierOrderActionError || error instanceof SupplierDomainError) return { error: error.message };
    return { error: "Koncept objednávky sa nepodarilo uložiť." };
  }
  refreshOrder(orderId, parsed.data.supplierId);
  if (previousSupplierId !== parsed.data.supplierId) refreshOrder(undefined, previousSupplierId);
  redirect(`/dodavatelia/objednavky/${orderId}`);
}

function transitionPermission(to: SupplierOrderStatus): FinancePermission | null {
  if (to === "APPROVED" || to === "CANCELLED") return "CONFIGURE";
  if (to === "SENT") return "SEND_DOCUMENT";
  return null;
}

export async function transitionSupplierOrder(
  orderId: string,
  to: SupplierOrderStatus,
  _previous: SupplierOrderFormState,
  formData: FormData,
): Promise<SupplierOrderFormState> {
  const user = await requireUser();
  const permission = transitionPermission(to);
  if (permission && !hasFinancePermission(user.role, permission)) return { error: "Na túto zmenu stavu nemáte oprávnenie." };
  if (!["APPROVED", "SENT", "CONFIRMED", "CANCELLED"].includes(to)) return { error: "Tento stav nemožno nastaviť ručne." };
  const confirmedDeliveryDate = parseDate(formData.get("confirmedDeliveryDate"));
  const cancelReason = optionalText(formData, "cancelReason");
  if (to === "CANCELLED" && !cancelReason) return { error: "Pri zrušení uveďte dôvod." };

  try {
    const supplierId = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SupplierOrder" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await tx.supplierOrder.findUnique({
        where: { id: orderId },
        include: { supplier: { include: { contacts: { where: { isPrimary: true }, take: 1 } } }, items: true },
      });
      if (!order) throw new SupplierOrderActionError("Objednávka neexistuje.");
      assertSupplierOrderTransition(order.status as SupplierOrderStatus, to);
      const now = new Date();
      const data: Prisma.SupplierOrderUpdateInput = { status: to };
      if (to === "APPROVED") {
        data.approvedAt = now;
        data.approvedById = user.userId;
      }
      if (to === "SENT") {
        const company = await tx.companyProfile.findFirst({
          where: { isActive: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }] },
          orderBy: { validFrom: "desc" },
        });
        if (!company) throw new SupplierOrderActionError("Pred odoslaním doplňte platný firemný profil.");
        data.sentAt = now;
        data.supplierSnapshot = {
          name: order.supplier.name,
          legalName: order.supplier.legalName,
          ico: order.supplier.ico,
          dic: order.supplier.dic,
          icDph: order.supplier.icDph,
          email: order.supplier.contacts[0]?.email ?? order.supplier.email,
        };
        data.deliveryLocationSnapshot = {
          legalName: company.legalName,
          street: company.street,
          city: company.city,
          zip: company.zip,
          country: company.country,
        };
      }
      if (to === "CONFIRMED") {
        data.confirmedAt = now;
        data.confirmedDeliveryDate = confirmedDeliveryDate ?? order.requestedDeliveryDate;
      }
      if (to === "CANCELLED") {
        data.cancelledAt = now;
        data.cancelReason = cancelReason;
      }
      await tx.supplierOrder.update({ where: { id: orderId }, data });
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: `SUPPLIER_ORDER_${to}`,
          entityType: "SupplierOrder",
          entityId: orderId,
          metadata: { supplierId: order.supplierId },
          beforeData: { status: order.status },
          afterData: { status: to, confirmedDeliveryDate: confirmedDeliveryDate?.toISOString(), cancelReason },
        },
      });
      return order.supplierId;
    });
    refreshOrder(orderId, supplierId);
    return { success: `Objednávka je teraz v stave „${supplierOrderStatusLabels[to] ?? to}“.` };
  } catch (error) {
    return {
      error: error instanceof SupplierOrderActionError || error instanceof SupplierDomainError
        ? error.message
        : "Zmenu stavu sa nepodarilo uložiť.",
    };
  }
}

export async function receiveSupplierOrder(
  orderId: string,
  _previous: SupplierOrderFormState,
  formData: FormData,
): Promise<SupplierOrderFormState> {
  const user = await requireUser();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(idempotencyKey)) return { error: "Neplatný identifikátor príjmu. Obnovte stránku." };
  const receivedAtRaw = String(formData.get("receivedAt") ?? "").trim();
  const receivedAt = parseDate(formData.get("receivedAt"));
  if (!receivedAt) return { error: "Dátum príjmu je povinný." };
  const todayInBratislava = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bratislava",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (receivedAtRaw > todayInBratislava) return { error: "Príjem nemožno zapísať do budúcnosti." };
  const linesParsed = z.array(receiptLineSchema).max(100).safeParse(parseJson(formData.get("items")));
  const returnablesParsed = z.array(receiptReturnableSchema).max(50).safeParse(parseJson(formData.get("returnables")));
  if (!linesParsed.success || !returnablesParsed.success) return { error: "Údaje príjmu nie sú platné." };
  const activeLines = linesParsed.data.filter((line) => line.quantity > 0);
  const activeReturnables = returnablesParsed.data.filter((item) => item.quantity > 0);
  if (activeLines.length === 0 && activeReturnables.length === 0) return { error: "Zadajte aspoň jednu prijatú položku alebo vratný obal." };

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SupplierOrder" WHERE "id" = ${orderId} FOR UPDATE`;
      const duplicate = await tx.supplierDelivery.findUnique({ where: { idempotencyKey } });
      if (duplicate) return { supplierId: "", duplicate: true };
      const order = await tx.supplierOrder.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { deliveryItems: { select: { quantity: true } } } },
          supplier: { select: { id: true } },
        },
      });
      if (!order) throw new SupplierOrderActionError("Objednávka neexistuje.");
      if (order.status !== "CONFIRMED" && order.status !== "PARTIALLY_RECEIVED") {
        throw new SupplierOrderActionError("Prijímať možno iba potvrdenú alebo čiastočne prijatú objednávku.");
      }
      const byId = new Map(order.items.map((item) => [item.id, item]));
      for (const line of activeLines) {
        const item = byId.get(line.orderItemId);
        if (!item) throw new SupplierOrderActionError("Prijímaná položka nepatrí do tejto objednávky.");
        const alreadyReceived = item.deliveryItems.reduce((sum, delivery) => sum + delivery.quantity, 0);
        if (alreadyReceived + line.quantity - item.quantity > 1e-9) {
          throw new SupplierOrderActionError(`Príjem „${item.description}“ prekračuje zostávajúce množstvo ${item.quantity - alreadyReceived} ${item.unit}.`);
        }
      }
      const returnableTypes = activeReturnables.length
        ? await tx.supplierReturnableType.findMany({
            where: { id: { in: activeReturnables.map((item) => item.returnableTypeId) }, supplierId: order.supplierId, isActive: true },
          })
        : [];
      if (returnableTypes.length !== activeReturnables.length) {
        throw new SupplierOrderActionError("Niektorý vratný obal nepatrí dodávateľovi alebo je neaktívny.");
      }
      if (activeReturnables.some((item) => item.dueDate && item.dueDate < receivedAt)) {
        throw new SupplierOrderActionError("Termín vrátenia obalu nesmie byť pred dátumom príjmu.");
      }
      const returnableById = new Map(returnableTypes.map((type) => [type.id, type]));
      const delivery = await tx.supplierDelivery.create({
        data: {
          supplierOrderId: order.id,
          deliveryNoteNumber: optionalText(formData, "deliveryNoteNumber") ?? null,
          receivedAt,
          note: optionalText(formData, "note") ?? null,
          createdById: user.userId,
          idempotencyKey,
        },
      });
      for (const line of activeLines) {
        const item = byId.get(line.orderItemId)!;
        let stockMovementId: string | null = null;
        const normalizedUnitPriceCents = Math.round(item.unitPriceCents / item.pricePerQuantity);
        if (item.materialId || item.productId) {
          const movement = await tx.stockMovement.create({
            data: {
              type: "PRIJEM",
              materialId: item.materialId,
              productId: item.productId,
              supplierId: order.supplierId,
              quantity: line.quantity,
              unitPriceCents: normalizedUnitPriceCents,
              note: `Príjem ${order.orderNumber}${optionalText(formData, "deliveryNoteNumber") ? ` · DL ${optionalText(formData, "deliveryNoteNumber")}` : ""}`,
              createdById: user.userId,
            },
          });
          stockMovementId = movement.id;
          if (item.materialId) {
            await tx.material.update({ where: { id: item.materialId }, data: { lastPriceCents: normalizedUnitPriceCents } });
          } else if (item.productId) {
            await tx.product.update({ where: { id: item.productId }, data: { lastPurchasePriceCents: normalizedUnitPriceCents } });
          }
        }
        await tx.supplierDeliveryItem.create({
          data: {
            supplierDeliveryId: delivery.id,
            supplierOrderItemId: item.id,
            quantity: line.quantity,
            stockMovementId,
          },
        });
      }
      for (const item of activeReturnables) {
        const returnableType = returnableById.get(item.returnableTypeId)!;
        const automaticDueDate = returnableType.expectedReturnDays
          ? new Date(receivedAt.getTime() + returnableType.expectedReturnDays * 24 * 60 * 60 * 1_000)
          : null;
        await tx.supplierReturnableMovement.create({
          data: {
            returnableTypeId: item.returnableTypeId,
            supplierDeliveryId: delivery.id,
            quantity: item.quantity,
            occurredAt: receivedAt,
            dueDate: item.dueDate ?? automaticDueDate,
            reference: optionalText(formData, "deliveryNoteNumber") ?? order.orderNumber,
            note: "Prevzaté pri príjme dodávky",
            createdById: user.userId,
          },
        });
      }
      const receiptLines = order.items.map((item) => ({
        orderedQuantity: item.quantity,
        receivedQuantity:
          item.deliveryItems.reduce((sum, delivered) => sum + delivered.quantity, 0) +
          (activeLines.find((line) => line.orderItemId === item.id)?.quantity ?? 0),
      }));
      const status = deriveSupplierOrderReceiptStatus(receiptLines);
      await tx.supplierOrder.update({ where: { id: order.id }, data: { status } });
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "SUPPLIER_DELIVERY_RECEIVED",
          entityType: "SupplierDelivery",
          entityId: delivery.id,
          metadata: { supplierId: order.supplierId, supplierOrderId: order.id },
          afterData: { status, lineCount: activeLines.length, returnableCount: activeReturnables.length, idempotencyKey },
        },
      });
      return { supplierId: order.supplierId, duplicate: false };
    });
    refreshOrder(orderId, result.supplierId || undefined);
    return { success: result.duplicate ? "Tento príjem už bol uložený; nevytvorili sa duplikáty." : "Príjem bol uložený a zásoby prepočítané." };
  } catch (error) {
    return { error: error instanceof SupplierOrderActionError || error instanceof SupplierDomainError ? error.message : "Príjem sa nepodarilo uložiť." };
  }
}

export async function updateStockTarget(
  itemRef: string,
  _previous: SupplierOrderFormState,
  formData: FormData,
): Promise<SupplierOrderFormState> {
  let user: AuthenticatedUser;
  try {
    user = await requireFinance("CONFIGURE");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Nemáte oprávnenie." };
  }
  const [kind, id] = itemRef.split(":");
  if ((kind !== "material" && kind !== "product") || !id) return { error: "Neplatná skladová položka." };
  const minStock = Number(String(formData.get("minStock") ?? "").replace(",", "."));
  const targetRaw = String(formData.get("targetStock") ?? "").trim();
  const targetStock = targetRaw ? Number(targetRaw.replace(",", ".")) : null;
  if (!Number.isFinite(minStock) || minStock < 0 || (targetStock !== null && (!Number.isFinite(targetStock) || targetStock < minStock))) {
    return { error: "Minimum musí byť nezáporné a cieľová zásoba nesmie byť nižšia než minimum." };
  }
  try {
    await prisma.$transaction(async (tx) => {
      const before = kind === "material"
        ? await tx.material.findUnique({ where: { id }, select: { minStock: true, targetStock: true } })
        : await tx.product.findUnique({ where: { id }, select: { minStock: true, targetStock: true } });
      if (!before) throw new SupplierOrderActionError("Skladová položka neexistuje.");
      if (kind === "material") await tx.material.update({ where: { id }, data: { minStock, targetStock } });
      else await tx.product.update({ where: { id }, data: { minStock, targetStock } });
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "STOCK_REPLENISHMENT_TARGET_UPDATED",
          entityType: kind === "material" ? "Material" : "Product",
          entityId: id,
          beforeData: { minStock: before.minStock, targetStock: before.targetStock },
          afterData: { minStock, targetStock },
        },
      });
    });
    refreshOrder();
    return { success: "Limity zásoby boli uložené." };
  } catch (error) {
    return { error: error instanceof SupplierOrderActionError ? error.message : "Limity sa nepodarilo uložiť." };
  }
}

export async function createReplenishmentDrafts(
  _previous: SupplierOrderFormState,
  formData: FormData,
): Promise<SupplierOrderFormState> {
  let user: AuthenticatedUser;
  try {
    user = await requireFinance("CREATE_DRAFT");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Nemáte oprávnenie." };
  }
  const parsed = z.array(replenishmentLineSchema).min(1, "Vyberte aspoň jednu položku.").max(100).safeParse(parseJson(formData.get("items")));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatný návrh doobjednania." };
  const itemKeys = parsed.data.map((item) => `${item.kind}:${item.itemId}`);
  if (new Set(itemKeys).size !== itemKeys.length) return { error: "Každú skladovú položku možno vybrať iba raz." };

  let createdIds: string[];
  try {
    createdIds = await prisma.$transaction(async (tx) => {
      const sorted = [...parsed.data].sort((left, right) => `${left.kind}:${left.itemId}`.localeCompare(`${right.kind}:${right.itemId}`));
      for (const item of sorted) {
        if (item.kind === "material") await tx.$queryRaw`SELECT "id" FROM "Material" WHERE "id" = ${item.itemId} FOR UPDATE`;
        else await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${item.itemId} FOR UPDATE`;
      }
      const offers = await tx.supplierCatalogItem.findMany({
        where: { id: { in: parsed.data.map((item) => item.catalogItemId) }, isActive: true, supplier: { isActive: true } },
        include: { supplier: true, prices: true },
      });
      if (offers.length !== parsed.data.length) throw new SupplierOrderActionError("Niektorá vybraná ponuka už nie je aktívna.");
      const offersById = new Map(offers.map((offer) => [offer.id, offer]));
      const verified: Array<{ supplierId: string; catalogItemId: string; quantity: number; leadTimeDays: number }> = [];
      for (const selection of parsed.data) {
        const offer = offersById.get(selection.catalogItemId);
        if (!offer) throw new SupplierOrderActionError("Vybraná ponuka neexistuje.");
        if (selection.kind === "material" ? offer.materialId !== selection.itemId : offer.productId !== selection.itemId) {
          throw new SupplierOrderActionError("Ponuka nepatrí k vybranej skladovej položke.");
        }
        const stock = await tx.stockMovement.aggregate({
          where: selection.kind === "material" ? { materialId: selection.itemId } : { productId: selection.itemId },
          _sum: { quantity: true },
        });
        const target = selection.kind === "material"
          ? await tx.material.findUnique({ where: { id: selection.itemId }, select: { isActive: true, minStock: true, targetStock: true } })
          : await tx.product.findUnique({ where: { id: selection.itemId }, select: { isActive: true, minStock: true, targetStock: true } });
        if (!target?.isActive) throw new SupplierOrderActionError("Skladová položka neexistuje alebo je neaktívna.");
        const openLines = await tx.supplierOrderItem.findMany({
          where: {
            ...(selection.kind === "material" ? { materialId: selection.itemId } : { productId: selection.itemId }),
            supplierOrder: { status: { in: ["DRAFT", "APPROVED", "SENT", "CONFIRMED", "PARTIALLY_RECEIVED"] } },
          },
          include: { deliveryItems: { select: { quantity: true } } },
        });
        const openOrderQuantity = openLines.reduce(
          (sum, line) => sum + Math.max(0, line.quantity - line.deliveryItems.reduce((received, delivery) => received + delivery.quantity, 0)),
          0,
        );
        const recommendation = recommendedOrderQuantity({
          currentQuantity: stock._sum.quantity ?? 0,
          openOrderQuantity,
          minStock: target.minStock,
          targetStock: target.targetStock,
          minOrderQuantity: offer.minOrderQuantity,
          packQuantity: offer.packQuantity,
          orderMultiple: offer.orderMultiple,
        });
        if (recommendation === 0) throw new SupplierOrderActionError("Niektorá položka už nie je pod limitom alebo ju pokrýva otvorená objednávka. Obnovte stránku.");
        if (selection.quantity + 1e-9 < recommendation) {
          throw new SupplierOrderActionError(`Zadané množstvo je nižšie než aktuálne odporúčanie ${recommendation} ${offer.unit}.`);
        }
        verified.push({ supplierId: offer.supplierId, catalogItemId: offer.id, quantity: selection.quantity, leadTimeDays: offer.leadTimeDays });
      }
      const groups = new Map<string, typeof verified>();
      for (const item of verified) groups.set(item.supplierId, [...(groups.get(item.supplierId) ?? []), item]);
      const created: string[] = [];
      const now = new Date();
      for (const [supplierId, items] of groups) {
        const { lines } = await resolveOrderLines(tx, supplierId, items, now);
        calculateSupplierOrderTotals(lines);
        const orderNumber = await nextNumber(tx, "NAKUP", now.getFullYear());
        const maxLeadTimeDays = Math.max(...items.map((item) => item.leadTimeDays));
        const requestedDeliveryDate = new Date(now.getTime() + maxLeadTimeDays * 24 * 60 * 60 * 1_000);
        const order = await tx.supplierOrder.create({
          data: {
            orderNumber,
            supplierId,
            orderDate: now,
            requestedDeliveryDate,
            note: "Automaticky pripravený koncept z doobjednania nízkych zásob.",
            createdById: user.userId,
            items: { create: lines },
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: user.userId,
            actorEmail: user.email,
            action: "SUPPLIER_ORDER_CREATED_FROM_REPLENISHMENT",
            entityType: "SupplierOrder",
            entityId: order.id,
            metadata: { supplierId, source: "REPLENISHMENT" },
            afterData: { orderNumber, itemCount: lines.length, status: "DRAFT" },
          },
        });
        created.push(order.id);
      }
      return created;
    });
  } catch (error) {
    return { error: error instanceof SupplierOrderActionError || error instanceof SupplierDomainError ? error.message : "Koncepty doobjednania sa nepodarilo vytvoriť." };
  }
  refreshOrder();
  if (createdIds.length === 1) redirect(`/dodavatelia/objednavky/${createdIds[0]}`);
  redirect("/dodavatelia/objednavky?stav=open");
}
