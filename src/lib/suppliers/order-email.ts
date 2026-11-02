import type { MailProvider } from "@/lib/finance/contracts";
import { MAIL_FROM, MAIL_REPLY_TO, mailProviderConfigured } from "@/lib/finance/mail/config";
import { NonRetryableError } from "@/lib/finance/outbox/errors";
import { formatCents, formatQty } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { calculateSupplierOrderTotals } from "./domain";

function textField(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function automaticPackagingMailReady(): boolean {
  return process.env.NODE_ENV !== "production" || (
    MAIL_FROM.toLowerCase() === "info@zdravyshot.sk" &&
    process.env.FINANCE_MAIL_DKIM_CONFIRMED === "true" &&
    mailProviderConfigured()
  );
}

export async function sendSupplierOrderEmail(input: { orderId: string; outboxEventId: string; provider: MailProvider; now: Date }): Promise<void> {
  const order = await prisma.supplierOrder.findUnique({ where: { id: input.orderId }, include: { items: { orderBy: { lineNumber: "asc" } } } });
  if (!order) throw new NonRetryableError("Nákupná objednávka neexistuje.");
  if (order.status === "SENT" || order.status === "CONFIRMED" || order.status === "PARTIALLY_RECEIVED" || order.status === "RECEIVED") return;
  if (order.status !== "APPROVED") throw new NonRetryableError("Nákupná objednávka už nie je schválená na odoslanie.");
  const email = textField(order.supplierSnapshot, "email");
  if (!email || !order.items.length) throw new NonRetryableError("Objednávke chýba príjemca alebo položky.");
  const supplierName = textField(order.supplierSnapshot, "legalName") ?? textField(order.supplierSnapshot, "name") ?? "dodávateľ";
  const deliveryName = textField(order.deliveryLocationSnapshot, "legalName");
  const deliveryAddress = [textField(order.deliveryLocationSnapshot, "street"), textField(order.deliveryLocationSnapshot, "zip"), textField(order.deliveryLocationSnapshot, "city")].filter(Boolean).join(", ");
  const totals = calculateSupplierOrderTotals(order.items.map((item) => ({
    quantity: item.quantity, unitPriceCents: item.unitPriceCents, pricePerQuantity: item.pricePerQuantity,
    priceType: item.priceType === "GROSS" ? "GROSS" : "NET", vatRate: item.vatRate,
  })), order.shippingCents, order.discountCents);
  const lines = order.items.map((item, index) => `${index + 1}. ${item.description}${item.supplierSku ? ` (${item.supplierSku})` : ""} — ${formatQty(item.quantity, item.unit)}; ${formatCents(totals.lines[index].totalGrossCents)} s DPH`);
  const body = [
    `Dobrý deň, ${supplierName},`, "", `objednávame u vás nasledujúce obaly (objednávka ${order.orderNumber}):`, "",
    ...lines, "", `Spolu s DPH: ${formatCents(totals.totalGrossCents)}`,
    "", `Miesto dodania: ${[deliveryName, deliveryAddress].filter(Boolean).join(", ")}`,
    "", "Prosíme o potvrdenie objednávky a termínu dodania.", "", "Zdravý Shot",
  ].join("\n");
  const result = await input.provider.send({
    idempotencyKey: `supplier-order:${order.id}:email`,
    from: MAIL_FROM, to: [email], replyTo: MAIL_REPLY_TO,
    subject: `Nákupná objednávka ${order.orderNumber} – Zdravý Shot`,
    text: body, documentIds: [],
  });
  if (!result.acceptedRecipients.some((recipient) => recipient.toLowerCase() === email.toLowerCase())) {
    throw new Error("E-mailový poskytovateľ neprijal adresu dodávateľa.");
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.supplierOrder.updateMany({ where: { id: order.id, status: "APPROVED" }, data: { status: "SENT", sentAt: input.now } });
    if (updated.count !== 1) throw new Error("Po odoslaní sa nepodarilo bezpečne označiť stav objednávky.");
    await tx.auditLog.create({ data: {
      actorEmail: "system", action: "SUPPLIER_ORDER_AUTO_EMAIL_SENT", entityType: "SupplierOrder", entityId: order.id,
      metadata: { outboxEventId: input.outboxEventId, provider: input.provider.providerName, providerMessageId: result.providerMessageId, toAddress: email },
      beforeData: { status: "APPROVED" }, afterData: { status: "SENT", sentAt: input.now.toISOString() },
    } });
  });
}
