import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { nextNumber } from "@/lib/invoicing";
import { configuredSecret } from "@/lib/security/secrets";
import { mapWooOrder, wooGmtDate, wooOrderSchema, type MappedOrderLine, type MappedOrderCharge } from "./mapper";
import { validWooSignature } from "./signature";

export const runtime = "nodejs";

const ignoredStatuses = new Set(["cancelled", "failed", "refunded", "trash"]);
const acceptedStatuses = new Set(["pending", "on-hold", "processing", "completed"]);

export async function POST(request: NextRequest) {
  const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET;
  if (!configuredSecret(secret)) return NextResponse.json({ error: "WooCommerce synchronizácia nie je zapnutá." }, { status: 503 });
  if (request.headers.get("x-wc-webhook-resource") !== "order" ||
      !["created", "updated"].includes(request.headers.get("x-wc-webhook-event") ?? "")) {
    return NextResponse.json({ error: "Nepodporovaná udalosť." }, { status: 400 });
  }
  let raw: string;
  try { raw = await request.text(); } catch { return NextResponse.json({ error: "Telo sa nepodarilo prečítať." }, { status: 400 }); }
  if (Buffer.byteLength(raw, "utf8") > 1_000_000) return NextResponse.json({ error: "Príliš veľká objednávka." }, { status: 413 });
  if (!validWooSignature(raw, request.headers.get("x-wc-webhook-signature"), secret)) {
    return NextResponse.json({ error: "Neplatný podpis." }, { status: 401 });
  }
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: "Neplatný JSON." }, { status: 400 }); }
  const parsed = wooOrderSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Neplatná WooCommerce objednávka." }, { status: 400 });
  const payload = parsed.data;
  const externalOrderId = String(payload.id);
  const modifiedAt = wooGmtDate(payload.date_modified_gmt);
  const createdAt = wooGmtDate(payload.date_created_gmt) ?? new Date();
  const hash = createHash("sha256").update(raw).digest("hex");

  let lines: MappedOrderLine[] | null = null;
  let charges: MappedOrderCharge[] | null = null;
  let issue: string | null = null;
  if (!ignoredStatuses.has(payload.status)) {
    if (!acceptedStatuses.has(payload.status)) issue = `Nepodporovaný stav WooCommerce: ${payload.status}.`;
    else {
      try {
        const skus = [...new Set(payload.line_items.map((line) => line.sku.trim()).filter(Boolean))];
        const products = skus.length ? await prisma.product.findMany({
          where: { OR: skus.map((sku) => ({ sku: { equals: sku, mode: "insensitive" } })) },
          select: { id: true, sku: true, name: true, vatRate: true, isActive: true },
        }) : [];
        const mapped = mapWooOrder(payload, products);
        lines = mapped.lines;
        charges = mapped.charges;
      } catch (error) {
        issue = error instanceof Error ? error.message : "Položky sa nepodarilo mapovať.";
      }
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const link = await tx.wooOrderSync.upsert({
        where: { externalOrderId },
        create: { externalOrderId, lastSeenAt: new Date() },
        update: { lastSeenAt: new Date() },
      });
      await tx.$queryRaw`SELECT id FROM "WooOrderSync" WHERE id = ${link.id} FOR UPDATE`;
      const current = await tx.wooOrderSync.findUniqueOrThrow({ where: { id: link.id } });
      if (modifiedAt && current.lastModifiedAt && modifiedAt < current.lastModifiedAt) {
        return { state: current.state, orderId: current.orderId, stale: true };
      }
      if (current.lastPayloadHash === hash && current.state !== "NEEDS_REVIEW") {
        return { state: current.state, orderId: current.orderId, duplicate: true };
      }
      const updateSync = async (state: "IMPORTED" | "NEEDS_REVIEW" | "IGNORED", reason: string | null, orderId = current.orderId) => {
        await tx.wooOrderSync.update({ where: { id: link.id }, data: {
          state, issue: reason, orderId, lastModifiedAt: modifiedAt, lastPayloadHash: hash, lastSeenAt: new Date(),
        } });
        return { state, orderId, issue: reason };
      };

      if (ignoredStatuses.has(payload.status)) {
        if (current.orderId) {
          const order = await tx.order.findUnique({
            where: { id: current.orderId }, include: { invoices: { select: { id: true } }, movements: { select: { id: true } } },
          });
          if (order && ["NOVA", "POTVRDENA"].includes(order.status) && !order.invoices.length && !order.movements.length) {
            await tx.order.update({ where: { id: order.id }, data: { status: "ZRUSENA" } });
          } else {
            return updateSync("NEEDS_REVIEW", `WooCommerce stav ${payload.status}; objednávka už má ďalšie spracovanie.`);
          }
        }
        return updateSync("IGNORED", `WooCommerce stav ${payload.status}.`);
      }
      if (issue || !lines || !charges) return updateSync("NEEDS_REVIEW", issue ?? "Položky chýbajú.");

      const linkedOrder = current.orderId ? await tx.order.findUnique({
        where: { id: current.orderId }, include: { invoices: { select: { id: true } }, movements: { select: { id: true } } },
      }) : null;
      if (current.orderId && (!linkedOrder || !["NOVA", "POTVRDENA"].includes(linkedOrder.status) ||
          linkedOrder.invoices.length || linkedOrder.movements.length)) {
        return updateSync("NEEDS_REVIEW", "WooCommerce objednávka sa zmenila po spracovaní v ERP; vyžaduje ručnú kontrolu.");
      }
      if (!current.orderId) {
        const older = await tx.order.findFirst({ where: { channel: "WEB", externalId: externalOrderId }, select: { id: true } });
        if (older) return updateSync("NEEDS_REVIEW", "Objednávka s týmto externým ID už existuje bez synchronizačnej väzby.");
      }

      const email = payload.billing.email.trim().toLowerCase();
      if (!z.email().safeParse(email).success) return updateSync("NEEDS_REVIEW", "WooCommerce objednávka nemá platný e-mail odberateľa.");
      let client = await tx.client.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
      if (!client && payload.billing.company?.trim()) {
        return updateSync("NEEDS_REVIEW", "Firemný odberateľ nemá zhodný e-mail v ERP; priraďte B2B klienta ručne.");
      }
      if (!client) {
        const name = [payload.billing.first_name, payload.billing.last_name].filter(Boolean).join(" ").trim();
        client = await tx.client.create({ data: {
          type: "B2C", name: name || email, email,
          phone: payload.billing.phone?.trim() || null,
          street: payload.billing.address_1?.trim() || null,
          city: payload.billing.city?.trim() || null,
          zip: payload.billing.postcode?.trim() || null,
        } });
      }
      if (!client.isActive) return updateSync("NEEDS_REVIEW", "Klient je v ERP neaktívny.");

      const nextStatus = payload.status === "processing" || payload.status === "completed" ? "POTVRDENA" : "NOVA";
      const note = [`WooCommerce #${payload.number ?? payload.id}`, payload.customer_note?.trim()].filter(Boolean).join(" · ").slice(0, 1000);
      if (linkedOrder) {
        await tx.orderItem.deleteMany({ where: { orderId: linkedOrder.id } });
        await tx.orderCharge.deleteMany({ where: { orderId: linkedOrder.id } });
        await tx.order.update({ where: { id: linkedOrder.id }, data: {
          clientId: client.id, status: nextStatus, note, items: { create: lines }, charges: { create: charges },
        } });
        return updateSync("IMPORTED", null, linkedOrder.id);
      }
      const orderNumber = await nextNumber(tx, "OBJ", createdAt.getUTCFullYear());
      const order = await tx.order.create({ data: {
        orderNumber, clientId: client.id, channel: "WEB", externalId: externalOrderId,
        orderDate: createdAt, status: nextStatus, note, items: { create: lines }, charges: { create: charges },
      } });
      return updateSync("IMPORTED", null, order.id);
    }, { timeout: 15_000 });
    if (result.state === "IMPORTED" || result.state === "IGNORED") {
      revalidatePath("/objednavky");
      revalidatePath("/objednavky/synchronizacia");
    }
    return NextResponse.json(result, { status: result.state === "NEEDS_REVIEW" ? 202 : 200 });
  } catch {
    return NextResponse.json({ error: "Synchronizácia objednávky zlyhala; WooCommerce môže udalosť zopakovať." }, { status: 500 });
  }
}
