"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { nextNumber, nextEntityNumber } from "@/lib/invoicing";
import { orderChannelSchema, orderStatusSchema, subscriptionFrequencySchema, orderStatusLabels, legalEntitySchema } from "@/lib/zod-schemas";
import { parseEurToCents } from "@/lib/format";
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
  legalEntity: legalEntitySchema.nullable(),
  channel: orderChannelSchema,
  orderDate: z.date().optional(),
  externalId: z.string().max(100).optional(),
  platformPaymentStatus: z.enum(["CUSTOMER_PAID", "UNCONFIRMED", "NOT_APPLICABLE"]).nullable(),
  customerPaidAt: z.date().optional(),
  platformSettledAt: z.date().optional(),
  platformSettlementCents: z.number().int().min(0).optional(),
  platformCommissionCents: z.number().int().min(0).optional(),
  shipmentStatus: z.enum(["NOT_SHIPPED", "SHIPPED_EXTERNALLY", "DELIVERED_EXTERNALLY"]).nullable(),
  shippedAt: z.date().optional(),
  deliveredAt: z.date().optional(),
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
  items: z.array(orderItemSchema),
  charges: z.array(z.object({
    kind: z.enum(["SHIPPING", "FEE"]),
    description: z.string().trim().min(1).max(200),
    unitPriceCents: z.number().int().min(0),
    vatRate: z.number().int().min(0).max(100),
    recipient: z.enum(["SELLER", "PLATFORM", "CARRIER", "UNKNOWN"]),
    taxTreatment: z.enum(["STANDARD", "NON_PAYER", "FOREIGN", "UNVERIFIED"]),
    includedInSellerTotal: z.boolean(),
  })).max(20),
}).refine((value) => value.items.length + value.charges.length > 0, { message: "Pridajte aspoň jednu položku alebo službu." });

function validDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime()) && new Date(value).toISOString().slice(0, 10) === value;
}

function parseOrderForm(formData: FormData) {
  let items: unknown;
  let rawCharges: unknown;
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
    rawCharges = JSON.parse(String(formData.get("charges") ?? "[]"));
  } catch {
    return { success: false as const, error: "Neplatné položky objednávky." };
  }
  if (!Array.isArray(rawCharges)) return { success: false as const, error: "Neplatné položky dopravy a služieb." };
  const charges: unknown[] = [];
  for (const [index, value] of rawCharges.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { success: false as const, error: `Neplatná služba ${index + 1}.` };
    const charge = value as Record<string, unknown>;
    let unitPriceCents: number;
    try { unitPriceCents = parseEurToCents(String(charge.priceEur ?? "")); }
    catch { return { success: false as const, error: `Cena dopravy alebo služby ${index + 1} je neplatná.` }; }
    if (unitPriceCents < 0 || unitPriceCents > 2_147_483_647) return { success: false as const, error: `Cena dopravy alebo služby ${index + 1} je mimo rozsahu.` };
    if (charge.taxTreatment === "NON_PAYER" && charge.vatRate !== 0) return { success: false as const, error: `Služba ${index + 1}: pri režime neplatiteľa musí byť DPH 0 %.` };
    charges.push({ ...charge, unitPriceCents, includedInSellerTotal: charge.recipient === "SELLER" });
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
  const dateNames = ["orderDate", "customerPaidAt", "platformSettledAt", "shippedAt", "deliveredAt"] as const;
  for (const name of dateNames) {
    const raw = String(formData.get(name) ?? "").trim();
    if (raw && !validDateKey(raw)) return { success: false as const, error: `Neplatný dátum: ${name}.` };
  }
  const centsOf = (name: string) => {
    const raw = String(formData.get(name) ?? "").trim();
    return raw ? parseEurToCents(raw) : undefined;
  };
  let platformSettlementCents: number | undefined;
  let platformCommissionCents: number | undefined;
  try { platformSettlementCents = centsOf("platformSettlementEur"); platformCommissionCents = centsOf("platformCommissionEur"); }
  catch { return { success: false as const, error: "Neplatná suma vyúčtovania alebo provízie platformy." }; }
  const parsed = orderFormSchema.safeParse({
    clientId: String(formData.get("clientId") ?? ""),
    legalEntity: String(formData.get("legalEntity") ?? "") || null,
    channel: String(formData.get("channel") ?? "MANUAL"),
    orderDate: formData.get("orderDate") ? new Date(String(formData.get("orderDate"))) : undefined,
    externalId: String(formData.get("externalId") ?? "").trim() || undefined,
    platformPaymentStatus: String(formData.get("platformPaymentStatus") ?? "") || null,
    customerPaidAt: formData.get("customerPaidAt") ? new Date(String(formData.get("customerPaidAt"))) : undefined,
    platformSettledAt: formData.get("platformSettledAt") ? new Date(String(formData.get("platformSettledAt"))) : undefined,
    platformSettlementCents, platformCommissionCents,
    shipmentStatus: String(formData.get("shipmentStatus") ?? "") || null,
    shippedAt: formData.get("shippedAt") ? new Date(String(formData.get("shippedAt"))) : undefined,
    deliveredAt: formData.get("deliveredAt") ? new Date(String(formData.get("deliveredAt"))) : undefined,
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
    charges,
  });
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? "Neplatné údaje." };
  }
  if (parsed.data.deliveryDate && parsed.data.latestDeliveryDate && parsed.data.latestDeliveryDate < parsed.data.deliveryDate) {
    return { success: false as const, error: "Najneskorší termín dodania nesmie byť pred preferovaným dátumom." };
  }
  if (parsed.data.shipmentStatus === "SHIPPED_EXTERNALLY" && !parsed.data.shippedAt) return { success: false as const, error: "Pri historickom odoslaní zadajte dátum odoslania." };
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
    if (parsed.data.externalId) {
      const duplicate = await tx.order.findFirst({ where: { channel: parsed.data.channel, externalId: parsed.data.externalId }, select: { orderNumber: true } });
      if (duplicate) throw new Error(`Externé číslo už patrí objednávke ${duplicate.orderNumber}.`);
    }
    if (inboxMessageId) {
      const message = await tx.inboxMessage.findUnique({ where: { id: inboxMessageId }, include: { order: true } });
      if (!message) throw new Error("Správa z inboxu neexistuje.");
      if (message.order) throw new Error(`Zo správy už bola vytvorená objednávka ${message.order.orderNumber}.`);
    }
    const now = new Date();
    const year = (parsed.data.orderDate ?? now).getFullYear();
    const orderNumber = parsed.data.legalEntity ? await nextEntityNumber(tx, "OBJ", year, parsed.data.legalEntity) : await nextNumber(tx, "OBJ", year);
    const created = await tx.order.create({
      data: {
        orderNumber,
        clientId: parsed.data.clientId,
        legalEntity: parsed.data.legalEntity,
        channel: parsed.data.channel,
        orderDate: parsed.data.orderDate ?? now,
        externalId: parsed.data.externalId ?? null,
        platformPaymentStatus: parsed.data.platformPaymentStatus,
        customerPaidAt: parsed.data.customerPaidAt ?? null,
        platformSettledAt: parsed.data.platformSettledAt ?? null,
        platformSettlementCents: parsed.data.platformSettlementCents ?? null,
        platformCommissionCents: parsed.data.platformCommissionCents ?? null,
        shipmentStatus: parsed.data.shipmentStatus,
        shippedAt: parsed.data.shippedAt ?? null,
        deliveredAt: parsed.data.deliveredAt ?? null,
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
        charges: { create: parsed.data.charges },
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

  const existing = await prisma.order.findUnique({ where: { id: orderId }, include: { invoices: { where: { direction: "VYDANA", documentStatus: { not: "CANCELLED" } }, select: { id: true } } } });
  if (!existing) return { error: "Objednávka neexistuje." };
  if (!EDITABLE_ORDER_STATUSES.includes(existing.status)) {
    return { error: `Objednávku v stave „${orderStatusLabels[existing.status] ?? existing.status}“ už nemožno upravovať.` };
  }
  if (existing.invoices.length) return { error: "Objednávka má vystavenú faktúru alebo koncept. Pred úpravou koncept zrušte; vystavenú faktúru treba riešiť opravou dokladu." };

  const updateError = await prisma.$transaction(async (tx) => {
    if (parsed.data.externalId) {
      const duplicate = await tx.order.findFirst({ where: { id: { not: orderId }, channel: parsed.data.channel, externalId: parsed.data.externalId }, select: { orderNumber: true } });
      if (duplicate) throw new Error(`Externé číslo už patrí objednávke ${duplicate.orderNumber}.`);
    }
    await tx.orderItem.deleteMany({ where: { orderId } });
    await tx.orderCharge.deleteMany({ where: { orderId } });
    await tx.order.update({
      where: { id: orderId },
      data: {
        clientId: parsed.data.clientId,
        legalEntity: parsed.data.legalEntity,
        channel: parsed.data.channel,
        orderDate: parsed.data.orderDate ?? existing.orderDate,
        externalId: parsed.data.externalId ?? null,
        platformPaymentStatus: parsed.data.platformPaymentStatus,
        customerPaidAt: parsed.data.customerPaidAt ?? null,
        platformSettledAt: parsed.data.platformSettledAt ?? null,
        platformSettlementCents: parsed.data.platformSettlementCents ?? null,
        platformCommissionCents: parsed.data.platformCommissionCents ?? null,
        shipmentStatus: parsed.data.shipmentStatus,
        shippedAt: parsed.data.shippedAt ?? null,
        deliveredAt: parsed.data.deliveredAt ?? null,
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
        charges: { create: parsed.data.charges },
      },
    });
  }).then(() => null, (error: unknown) => error instanceof Error ? error.message : "Objednávku sa nepodarilo uložiť.");
  if (updateError) return { error: updateError };

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
