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
import { parseUnitPrice, unitPriceCents } from "@/lib/precise-price";

export interface OrderFormState {
  error?: string;
  success?: string;
  priceErrorIndex?: number;
}

// ---------- Objednávky ----------

const orderItemSchema = z.object({
  productId: z.string().min(1, "Vyberte produkt"),
  quantity: z.number().int().positive("Množstvo musí byť kladné celé číslo"),
  unitPriceExact: z.string(),
  priceSource: z.enum(["CLIENT", "B2B", "B2C", "MANUAL"]),
  minimumExpiryDate: z.string().optional(),
  vatRate: z.number().int().min(0).max(100),
});

const orderFormSchema = z.object({
  clientId: z.string().min(1, "Vyberte klienta"),
  channel: orderChannelSchema,
  deliveryDate: z.date().optional(),
  latestDeliveryDate: z.date().optional(),
  deliveryStreet: z.string().max(200).optional(),
  deliveryCity: z.string().max(100).optional(),
  deliveryZip: z.string().max(30).optional(),
  deliveryCountry: z.string().max(100).optional(),
  deliveryContact: z.string().max(200).optional(),
  paymentMethod: z.enum(["UNKNOWN", "UNAGREED", "INVOICE", "CARD_ON_DELIVERY", "BANK_TRANSFER", "CASH"]),
  paymentTermDays: z.number().int().min(0).max(365).optional(),
  note: z.string().optional(),
  items: z.array(orderItemSchema).min(1, "Pridajte aspoň jednu položku"),
});

function validDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime()) && new Date(value).toISOString().slice(0, 10) === value;
}

function parseOrderForm(formData: FormData) {
  let items: unknown;
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { success: false as const, error: "Neplatné položky objednávky." };
  }
  if (Array.isArray(items)) {
    for (let index = 0; index < items.length; index++) {
      if (!items[index] || typeof items[index] !== "object" || Array.isArray(items[index])) {
        return { success: false as const, error: `Neplatná položka ${index + 1}.` };
      }
      const item = items[index] as Record<string, unknown>;
      try {
        item.unitPriceExact = parseUnitPrice(String(item.unitPriceExact ?? ""));
      } catch (error) {
        return { success: false as const, error: `Cena pri položke ${index + 1}: ${error instanceof Error ? error.message : "Neplatná cena."}`, priceErrorIndex: index };
      }
      if (item.minimumExpiryDate && (typeof item.minimumExpiryDate !== "string" || !validDateKey(item.minimumExpiryDate))) {
        return { success: false as const, error: `Neplatný dátum minimálnej trvanlivosti pri položke ${index + 1}.` };
      }
    }
  }
  const deliveryDateRaw = String(formData.get("deliveryDate") ?? "").trim();
  const latestDeliveryDateRaw = String(formData.get("latestDeliveryDate") ?? "").trim();
  if ((deliveryDateRaw && !validDateKey(deliveryDateRaw)) || (latestDeliveryDateRaw && !validDateKey(latestDeliveryDateRaw))) {
    return { success: false as const, error: "Zadajte platný dátum dodania." };
  }
  const paymentTermRaw = String(formData.get("paymentTermDays") ?? "").trim();
  const parsed = orderFormSchema.safeParse({
    clientId: String(formData.get("clientId") ?? ""),
    channel: String(formData.get("channel") ?? "MANUAL"),
    deliveryDate: deliveryDateRaw ? new Date(deliveryDateRaw) : undefined,
    latestDeliveryDate: latestDeliveryDateRaw ? new Date(latestDeliveryDateRaw) : undefined,
    deliveryStreet: String(formData.get("deliveryStreet") ?? "").trim() || undefined,
    deliveryCity: String(formData.get("deliveryCity") ?? "").trim() || undefined,
    deliveryZip: String(formData.get("deliveryZip") ?? "").trim() || undefined,
    deliveryCountry: String(formData.get("deliveryCountry") ?? "").trim() || undefined,
    deliveryContact: String(formData.get("deliveryContact") ?? "").trim() || undefined,
    paymentMethod: String(formData.get("paymentMethod") ?? "UNAGREED"),
    paymentTermDays: paymentTermRaw ? Number(paymentTermRaw) : undefined,
    note: String(formData.get("note") ?? "").trim() || undefined,
    items,
  });
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? "Neplatné údaje." };
  }
  if (parsed.data.deliveryDate && parsed.data.latestDeliveryDate && parsed.data.latestDeliveryDate < parsed.data.deliveryDate) {
    return { success: false as const, error: "Najneskorší termín dodania nesmie byť pred preferovaným dátumom." };
  }
  return { success: true as const, data: {
    ...parsed.data,
    items: parsed.data.items.map((item) => ({
      productId: item.productId, quantity: item.quantity, vatRate: item.vatRate,
      unitPriceExact: item.unitPriceExact, unitPriceCents: unitPriceCents(item.unitPriceExact),
      priceSource: item.priceSource,
      minimumExpiryDate: item.minimumExpiryDate ? new Date(item.minimumExpiryDate) : null,
    })),
  } };
}

export async function createOrder(_prevState: OrderFormState, formData: FormData): Promise<OrderFormState> {
  const parsed = parseOrderForm(formData);
  if (!parsed.success) return { error: parsed.error, priceErrorIndex: parsed.priceErrorIndex };
  await requireUser();

  const inboxMessageId = String(formData.get("inboxMessageId") ?? "").trim() || null;
  const submissionKey = String(formData.get("submissionKey") ?? "").trim();
  if (!/^[a-f0-9-]{36}$/.test(submissionKey)) return { error: "Obnovte formulár a skúste objednávku uložiť znova." };

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
        latestDeliveryDate: parsed.data.latestDeliveryDate ?? null,
        deliveryStreet: parsed.data.deliveryStreet ?? null,
        deliveryCity: parsed.data.deliveryCity ?? null,
        deliveryZip: parsed.data.deliveryZip ?? null,
        deliveryCountry: parsed.data.deliveryCountry ?? null,
        deliveryContact: parsed.data.deliveryContact ?? null,
        paymentMethod: parsed.data.paymentMethod,
        paymentTermDays: parsed.data.paymentTermDays ?? null,
        submissionKey,
        note: parsed.data.note ?? null,
        inboxMessageId,
        items: { create: parsed.data.items },
      },
    });
    if (inboxMessageId) {
      await tx.inboxMessage.update({ where: { id: inboxMessageId }, data: { status: "SPRACOVANA" } });
    }
    return created;
  }).catch(async (e: unknown) => {
    const existing = await prisma.order.findUnique({ where: { submissionKey }, select: { id: true } });
    return existing ?? { error: e instanceof Error ? e.message : "Objednávku sa nepodarilo vytvoriť." };
  });

  if ("error" in order) return { error: order.error };

  revalidatePath("/objednavky");
  revalidatePath("/klienti");
  redirect(`/objednavky/${order.id}?ulozene=1`);
}

export async function updateOrder(orderId: string, _prevState: OrderFormState, formData: FormData): Promise<OrderFormState> {
  const parsed = parseOrderForm(formData);
  if (!parsed.success) return { error: parsed.error, priceErrorIndex: parsed.priceErrorIndex };
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
        latestDeliveryDate: parsed.data.latestDeliveryDate ?? null,
        deliveryStreet: parsed.data.deliveryStreet ?? null,
        deliveryCity: parsed.data.deliveryCity ?? null,
        deliveryZip: parsed.data.deliveryZip ?? null,
        deliveryCountry: parsed.data.deliveryCountry ?? null,
        deliveryContact: parsed.data.deliveryContact ?? null,
        paymentMethod: parsed.data.paymentMethod,
        paymentTermDays: parsed.data.paymentTermDays ?? null,
        note: parsed.data.note ?? null,
        items: { create: parsed.data.items },
      },
    });
  });

  revalidatePath("/objednavky");
  revalidatePath(`/objednavky/${orderId}`);
  redirect(`/objednavky/${orderId}?ulozene=1`);
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
        const demand = new Map<string, { name: string; items: typeof order.items }>();
        for (const item of order.items) {
          const current = demand.get(item.productId);
          demand.set(item.productId, { name: item.product.name, items: [...(current?.items ?? []), item] });
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
          let unassigned = balances.find((row) => row.productId === productId && row.batchId === null)?._sum.quantity ?? 0;
          for (const item of [...itemDemand.items].sort((a, b) => (b.minimumExpiryDate?.getTime() ?? 0) - (a.minimumExpiryDate?.getTime() ?? 0))) {
            if (item.minimumExpiryDate && unassigned < 0) {
              throw new Error(`Exspiráciu produktu ${itemDemand.name} nemožno overiť: historické pohyby bez šarže vyžadujú revíziu skladu.`);
            }
            const requiredExpiry = new Date(Math.max(earliestValidExpiry.getTime(), order.deliveryDate?.getTime() ?? 0, item.minimumExpiryDate?.getTime() ?? 0));
            let allocations;
            try {
              allocations = allocateProductStock(batchPools, item.minimumExpiryDate ? 0 : unassigned, item.quantity, requiredExpiry);
            } catch (error) {
              if (error instanceof InsufficientProductStockError) {
                throw new Error(`Šarža produktu ${itemDemand.name} nespĺňa požadovanú exspiráciu alebo chýba použiteľná zásoba. K dispozícii ${error.available} ks, potrebných ${item.quantity} ks.`);
              }
              throw error;
            }
            for (const allocation of allocations) {
              if (allocation.batchId) {
                const pool = batchPools.find((batch) => batch.batchId === allocation.batchId)!;
                pool.quantity -= allocation.quantity;
              } else unassigned -= allocation.quantity;
              await tx.stockMovement.create({ data: {
                type: "PREDAJ", productId, quantity: -allocation.quantity,
                batchId: allocation.batchId, orderId: order.id,
                note: allocation.batchId ? `Expedícia ${order.orderNumber}` : `Expedícia ${order.orderNumber} · šarža neurčená`,
                createdById: user.userId,
              } });
            }
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
      client: { include: { productPrices: true, priceRules: true } },
      items: { include: { product: true } },
    },
  });

  if (due.length === 0) return { success: "Žiadne predplatné nie je splatné — nič sa negenerovalo." };

  for (const sub of due) {
    for (const item of sub.items) {
      const unitPriceCents = resolveUnitPriceCents(
        sub.client.type, item.product, sub.client.productPrices,
        sub.client.priceRules.map((rule) => ({ ...rule, effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10) })),
        sub.nextRunDate.toISOString().slice(0, 10),
      );
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
                sub.client.priceRules.map((rule) => ({ ...rule, effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10) })),
                sub.nextRunDate.toISOString().slice(0, 10),
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
