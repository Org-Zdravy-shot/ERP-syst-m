"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { nextNumber } from "@/lib/invoicing";
import { orderChannelSchema, orderStatusSchema, subscriptionFrequencySchema, orderStatusLabels } from "@/lib/zod-schemas";
import { ORDER_STATUS_TRANSITIONS, EDITABLE_ORDER_STATUSES } from "./konstanty";
import { resolveUnitPriceCents } from "./pricing";
import { allocateProductStock, InsufficientProductStockError } from "@/lib/stock-allocation";

export interface OrderFormState {
  error?: string;
  success?: string;
}

// ---------- Objednávky ----------

const orderItemSchema = z.object({
  productId: z.string().min(1, "Vyberte produkt"),
  quantity: z.number().int().positive("Množstvo musí byť kladné celé číslo"),
  unitPriceCents: z.number().int().nonnegative("Cena nesmie byť záporná"),
  vatRate: z.number().int().nonnegative(),
});

const orderFormSchema = z.object({
  clientId: z.string().min(1, "Vyberte klienta"),
  channel: orderChannelSchema,
  deliveryDate: z.date().optional(),
  note: z.string().optional(),
  items: z.array(orderItemSchema).min(1, "Pridajte aspoň jednu položku"),
});

function parseOrderForm(formData: FormData) {
  let items: unknown;
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { success: false as const, error: "Neplatné položky objednávky." };
  }
  const deliveryDateRaw = String(formData.get("deliveryDate") ?? "").trim();
  const parsed = orderFormSchema.safeParse({
    clientId: String(formData.get("clientId") ?? ""),
    channel: String(formData.get("channel") ?? "MANUAL"),
    deliveryDate: deliveryDateRaw ? new Date(deliveryDateRaw) : undefined,
    note: String(formData.get("note") ?? "").trim() || undefined,
    items,
  });
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? "Neplatné údaje." };
  }
  return { success: true as const, data: parsed.data };
}

export async function createOrder(_prevState: OrderFormState, formData: FormData): Promise<OrderFormState> {
  const parsed = parseOrderForm(formData);
  if (!parsed.success) return { error: parsed.error };
  await requireUser();

  const inboxMessageId = String(formData.get("inboxMessageId") ?? "").trim() || null;

  const order = await prisma.$transaction(async (tx) => {
    if (inboxMessageId) {
      const message = await tx.inboxMessage.findUnique({ where: { id: inboxMessageId }, include: { order: true } });
      if (!message) throw new Error("Správa z inboxu neexistuje.");
      if (message.order) throw new Error(`Zo správy už bola vytvorená objednávka ${message.order.orderNumber}.`);
    }
    const now = new Date();
    const orderNumber = await nextNumber(tx, "OBJ", now.getFullYear());
    const created = await tx.order.create({
      data: {
        orderNumber,
        clientId: parsed.data.clientId,
        channel: parsed.data.channel,
        deliveryDate: parsed.data.deliveryDate ?? null,
        note: parsed.data.note ?? null,
        inboxMessageId,
        items: { create: parsed.data.items },
      },
    });
    if (inboxMessageId) {
      await tx.inboxMessage.update({ where: { id: inboxMessageId }, data: { status: "SPRACOVANA" } });
    }
    return created;
  }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "Objednávku sa nepodarilo vytvoriť." }));

  if ("error" in order) return { error: order.error };

  revalidatePath("/objednavky");
  revalidatePath("/klienti");
  redirect(`/objednavky/${order.id}`);
}

export async function updateOrder(orderId: string, _prevState: OrderFormState, formData: FormData): Promise<OrderFormState> {
  const parsed = parseOrderForm(formData);
  if (!parsed.success) return { error: parsed.error };
  await requireUser();

  const existing = await prisma.order.findUnique({ where: { id: orderId } });
  if (!existing) return { error: "Objednávka neexistuje." };
  if (!EDITABLE_ORDER_STATUSES.includes(existing.status)) {
    return { error: `Objednávku v stave „${orderStatusLabels[existing.status] ?? existing.status}“ už nemožno upravovať.` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.orderItem.deleteMany({ where: { orderId } });
    await tx.order.update({
      where: { id: orderId },
      data: {
        clientId: parsed.data.clientId,
        channel: parsed.data.channel,
        deliveryDate: parsed.data.deliveryDate ?? null,
        note: parsed.data.note ?? null,
        items: { create: parsed.data.items },
      },
    });
  });

  revalidatePath("/objednavky");
  revalidatePath(`/objednavky/${orderId}`);
  redirect(`/objednavky/${orderId}`);
}

/**
 * Zmena stavu objednávky podľa povolených prechodov.
 * Prechod na EXPEDOVANA v jednej transakcii vytvorí pohyby PREDAJ (−množstvo)
 * a odmietne expedíciu pri nedostatku zásob — žiadne záporné stavy.
 */
export async function setOrderStatus(orderId: string, _prevState: OrderFormState, formData: FormData): Promise<OrderFormState> {
  const statusParsed = orderStatusSchema.safeParse(String(formData.get("status") ?? ""));
  if (!statusParsed.success) return { error: "Neplatný stav." };
  const newStatus = statusParsed.data;
  const user = await requireUser();

  try {
    await prisma.$transaction(async (tx) => {
      // Zamkne objednávku aj pri dvoch súbežných kliknutiach z rôznych zariadení.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { product: true } } },
      });
      if (!order) throw new Error("Objednávka neexistuje.");
      if (!(ORDER_STATUS_TRANSITIONS[order.status] ?? []).includes(newStatus)) {
        throw new Error(
          `Prechod zo stavu „${orderStatusLabels[order.status] ?? order.status}“ na „${orderStatusLabels[newStatus] ?? newStatus}“ nie je povolený.`,
        );
      }

      if (newStatus === "EXPEDOVANA") {
        const demand = new Map<string, { name: string; quantity: number }>();
        for (const item of order.items) {
          const current = demand.get(item.productId);
          demand.set(item.productId, { name: item.product.name, quantity: (current?.quantity ?? 0) + item.quantity });
        }
        const productIds = [...demand.keys()].sort();
        // Všetky výdaje produktu používajú rovnaký zámok v pevnom poradí.
        for (const productId of productIds) {
          await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} FOR UPDATE`;
        }
        const [balances, batches] = await Promise.all([
          tx.stockMovement.groupBy({
            by: ["productId", "batchId"],
            where: { productId: { in: productIds } },
            _sum: { quantity: true },
          }),
          tx.productionBatch.findMany({
            where: { productId: { in: productIds }, status: "DONE" },
            select: { id: true, productId: true, expiryDate: true },
          }),
        ]);
        const now = new Date();
        const dateParts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Bratislava", year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(now);
        const dayPart = (type: string) => Number(dateParts.find((part) => part.type === type)?.value);
        const earliestValidExpiry = new Date(Date.UTC(dayPart("year"), dayPart("month") - 1, dayPart("day")));

        for (const productId of productIds) {
          const itemDemand = demand.get(productId)!;
          const batchPools = batches.map((batch) => ({
            batchId: batch.id,
            productId: batch.productId,
            expiryDate: batch.expiryDate,
            quantity: balances.find((row) => row.productId === productId && row.batchId === batch.id)?._sum.quantity ?? 0,
          })).filter((batch) => batch.productId === productId);
          const unassigned = balances.find((row) => row.productId === productId && row.batchId === null)?._sum.quantity ?? 0;
          let allocations;
          try {
            allocations = allocateProductStock(batchPools, unassigned, itemDemand.quantity, earliestValidExpiry);
          } catch (error) {
            if (error instanceof InsufficientProductStockError) {
              throw new Error(`Nedostatok použiteľných zásob: ${itemDemand.name} — k dispozícii ${error.available} ks, potrebných ${itemDemand.quantity} ks. Skontrolujte aj exspiráciu.`);
            }
            throw error;
          }
          for (const allocation of allocations) {
            await tx.stockMovement.create({
              data: {
                type: "PREDAJ", productId, quantity: -allocation.quantity,
                batchId: allocation.batchId, orderId: order.id,
                note: allocation.batchId ? `Expedícia ${order.orderNumber}` : `Expedícia ${order.orderNumber} · šarža neurčená`,
                createdById: user.userId,
              },
            });
          }
        }
      }

      await tx.order.update({ where: { id: orderId }, data: { status: newStatus } });
    }, { timeout: 15_000 });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Zmena stavu zlyhala." };
  }

  revalidatePath("/objednavky");
  revalidatePath(`/objednavky/${orderId}`);
  revalidatePath("/sklad");
  revalidatePath("/");
  return { success: `Stav zmenený na „${orderStatusLabels[newStatus]}“.` };
}

// ---------- Predplatné ----------

const subscriptionItemSchema = z.object({
  productId: z.string().min(1, "Vyberte produkt"),
  quantity: z.number().int().positive("Množstvo musí byť kladné celé číslo"),
});

const subscriptionFormSchema = z.object({
  clientId: z.string().min(1, "Vyberte klienta"),
  frequency: subscriptionFrequencySchema,
  nextRunDate: z.date(),
  note: z.string().optional(),
  items: z.array(subscriptionItemSchema).min(1, "Pridajte aspoň jednu položku"),
});

export async function createSubscription(_prevState: OrderFormState, formData: FormData): Promise<OrderFormState> {
  let items: unknown;
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "Neplatné položky predplatného." };
  }
  const nextRunRaw = String(formData.get("nextRunDate") ?? "").trim();
  const parsed = subscriptionFormSchema.safeParse({
    clientId: String(formData.get("clientId") ?? ""),
    frequency: String(formData.get("frequency") ?? ""),
    nextRunDate: nextRunRaw ? new Date(nextRunRaw) : undefined,
    note: String(formData.get("note") ?? "").trim() || undefined,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatné údaje." };
  await requireUser();

  await prisma.subscription.create({
    data: {
      clientId: parsed.data.clientId,
      frequency: parsed.data.frequency,
      nextRunDate: parsed.data.nextRunDate,
      note: parsed.data.note ?? null,
      items: { create: parsed.data.items },
    },
  });

  revalidatePath("/objednavky/predplatne");
  redirect("/objednavky/predplatne");
}

export async function toggleSubscriptionActive(subscriptionId: string): Promise<void> {
  await requireUser();
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) return;
  await prisma.subscription.update({ where: { id: subscriptionId }, data: { isActive: !sub.isActive } });
  revalidatePath("/objednavky/predplatne");
}

function advanceDate(date: Date, frequency: string): Date {
  const next = new Date(date);
  if (frequency === "WEEKLY") next.setDate(next.getDate() + 7);
  else if (frequency === "BIWEEKLY") next.setDate(next.getDate() + 14);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

/**
 * Vygeneruje objednávky zo všetkých aktívnych predplatných so splatným nextRunDate
 * (kanál SUBSCRIPTION, ceny podľa typu klienta) a posunie nextRunDate o frekvenciu.
 */
export async function generateSubscriptionOrders(_prevState: OrderFormState, _formData: FormData): Promise<OrderFormState> {
  await requireUser();

  const now = new Date();
  const due = await prisma.subscription.findMany({
    where: { isActive: true, nextRunDate: { lte: now } },
    include: {
      client: { include: { productPrices: true } },
      items: { include: { product: true } },
    },
  });

  if (due.length === 0) return { success: "Žiadne predplatné nie je splatné — nič sa negenerovalo." };

  for (const sub of due) {
    for (const item of sub.items) {
      const unitPriceCents = resolveUnitPriceCents(sub.client.type, item.product, sub.client.productPrices);
      if (unitPriceCents === null) {
        return {
          error: `Klient ${sub.client.name} nemá nastavenú B2B cenu produktu ${item.product.name}. Objednávky sa nevygenerovali.`,
        };
      }
    }
  }

  const numbers: string[] = [];
  for (const sub of due) {
    const orderNumber = await prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, "OBJ", now.getFullYear());
      await tx.order.create({
        data: {
          orderNumber: number,
          clientId: sub.clientId,
          channel: "SUBSCRIPTION",
          subscriptionId: sub.id,
          deliveryDate: sub.nextRunDate,
          note: sub.note ?? null,
          items: {
            create: sub.items.map((item) => {
              const unitPriceCents = resolveUnitPriceCents(
                sub.client.type,
                item.product,
                sub.client.productPrices,
              );
              if (unitPriceCents === null) throw new Error("B2B cena nie je nastavená.");
              return {
                productId: item.productId,
                quantity: item.quantity,
                unitPriceCents,
                vatRate: item.product.vatRate,
              };
            }),
          },
        },
      });
      await tx.subscription.update({
        where: { id: sub.id },
        data: { nextRunDate: advanceDate(sub.nextRunDate, sub.frequency) },
      });
      return number;
    });
    numbers.push(orderNumber);
  }

  revalidatePath("/objednavky");
  revalidatePath("/objednavky/predplatne");
  return { success: `Vygenerované objednávky: ${numbers.join(", ")}.` };
}

// ---------- Inbox ----------

export async function setInboxStatus(messageId: string, status: "NOVA" | "IGNOROVANA"): Promise<void> {
  await requireUser();
  await prisma.inboxMessage.update({ where: { id: messageId }, data: { status } });
  revalidatePath("/objednavky/inbox");
  revalidatePath(`/objednavky/inbox/${messageId}`);
}
