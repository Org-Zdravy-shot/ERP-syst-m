"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { formatCents } from "@/lib/format";

export interface MatchState { error?: string; success?: string }

function receiptDay(date: Date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return { start, end: new Date(start.getTime() + 24 * 3600 * 1000) };
}

export async function matchEkasaReceipt(saleId: string, _prev: MatchState, formData: FormData): Promise<MatchState> {
  const user = await requireFinancePermission("CONFIGURE");
  const invoiceNumber = String(formData.get("invoiceNumber") ?? "").trim();
  if (!invoiceNumber || invoiceNumber.length > 100) return { error: "Zadajte presné číslo vydanej faktúry." };

  try {
    await prisma.$transaction(async (tx) => {
      const sale = await tx.ekasaSale.findUnique({ where: { id: saleId } });
      if (!sale?.receiptNumber) throw new Error("eKasa položka nemá identifikátor dokladu.");
      const invoice = await tx.invoice.findUnique({ where: { invoiceNumber } });
      if (!invoice || invoice.direction !== "VYDANA" || invoice.documentType !== "INVOICE" || invoice.documentStatus !== "ISSUED") {
        throw new Error("Takáto finalizovaná vydaná faktúra neexistuje.");
      }
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoice.id} FOR UPDATE`;
      const { start, end } = receiptDay(sale.saleDate);
      const where = { source: sale.source, receiptNumber: sale.receiptNumber, saleDate: { gte: start, lt: end } };
      const rows = await tx.ekasaSale.findMany({ where, orderBy: { id: "asc" } });
      for (const row of rows) await tx.$queryRaw`SELECT id FROM "EkasaSale" WHERE id = ${row.id} FOR UPDATE`;
      const locked = await tx.ekasaSale.findMany({ where });
      if (locked.some((row) => row.matchedInvoiceId && row.matchedInvoiceId !== invoice.id)) {
        throw new Error("Niektorá položka dokladu už patrí inej faktúre.");
      }
      const elsewhere = await tx.ekasaSale.count({
        where: { matchedInvoiceId: invoice.id, id: { notIn: locked.map((row) => row.id) } },
      });
      if (elsewhere) throw new Error("Faktúra je už spárovaná s iným eKasa dokladom.");
      const total = locked.reduce((sum, row) => sum + row.totalGrossCents, 0);
      if (total !== invoice.totalGrossCents) {
        throw new Error(`Suma eKasa dokladu (${formatCents(total)}) sa nezhoduje s faktúrou (${formatCents(invoice.totalGrossCents)}).`);
      }
      await tx.ekasaSale.updateMany({ where: { id: { in: locked.map((row) => row.id) } }, data: { matchedInvoiceId: invoice.id } });
      await tx.auditLog.create({ data: {
        actorId: user.userId, actorEmail: user.email, action: "EKASA_INVOICE_MATCHED",
        entityType: "Invoice", entityId: invoice.id,
        afterData: { receiptNumber: sale.receiptNumber, source: sale.source, saleIds: locked.map((row) => row.id), totalGrossCents: total },
      } });
    }, { timeout: 15_000 });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Doklad sa nepodarilo spárovať." };
  }
  revalidatePath("/financie");
  revalidatePath("/financie/ekasa");
  revalidatePath("/plan");
  revalidatePath("/");
  return { success: "eKasa doklad a faktúra sú spárované." };
}

export async function unmatchEkasaReceipt(saleId: string, _prev: MatchState, _formData: FormData): Promise<MatchState> {
  const user = await requireFinancePermission("CONFIGURE");
  try {
    await prisma.$transaction(async (tx) => {
      const sale = await tx.ekasaSale.findUnique({ where: { id: saleId } });
      if (!sale?.receiptNumber || !sale.matchedInvoiceId) throw new Error("Doklad nie je spárovaný.");
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${sale.matchedInvoiceId} FOR UPDATE`;
      const { start, end } = receiptDay(sale.saleDate);
      const rows = await tx.ekasaSale.findMany({
        where: { source: sale.source, receiptNumber: sale.receiptNumber, saleDate: { gte: start, lt: end } },
        orderBy: { id: "asc" },
      });
      for (const row of rows) await tx.$queryRaw`SELECT id FROM "EkasaSale" WHERE id = ${row.id} FOR UPDATE`;
      const locked = await tx.ekasaSale.findMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });
      if (locked.some((row) => row.matchedInvoiceId !== sale.matchedInvoiceId)) {
        throw new Error("Položky dokladu nie sú spárované jednotne; najprv ich skontrolujte.");
      }
      await tx.ekasaSale.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { matchedInvoiceId: null } });
      await tx.auditLog.create({ data: {
        actorId: user.userId, actorEmail: user.email, action: "EKASA_INVOICE_MATCH_REMOVED",
        entityType: "Invoice", entityId: sale.matchedInvoiceId,
        afterData: { receiptNumber: sale.receiptNumber, source: sale.source, saleIds: rows.map((row) => row.id) },
      } });
    }, { timeout: 15_000 });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Párovanie sa nepodarilo zrušiť." };
  }
  revalidatePath("/financie");
  revalidatePath("/financie/ekasa");
  revalidatePath("/plan");
  revalidatePath("/");
  return { success: "Párovanie bolo zrušené." };
}
