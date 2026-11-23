import type { Invoice } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hasFinancePermission } from "../permissions";
import { invoiceService } from "../invoice-service";
import { isVatPayerAtDate } from "../domain";

const intervals = [1, 3, 6, 12] as const;
export const recurringInputSchema = z.object({
  submissionKey: z.uuid(),
  sourceInvoiceId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(150),
  startDate: z.iso.date(),
  intervalMonths: z.number().refine(value => intervals.some(interval => interval === value), "Vyberte podporovaný interval."),
  dueDays: z.number().int().min(0).max(180),
  maxCount: z.number().int().min(1).max(999).optional(),
});

export function todaySlovakia(now = new Date()): Date {
  return new Date(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bratislava" }).format(now));
}

export function scheduledOccurrence(start: Date, intervalMonths: number, ordinal: number): Date {
  const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + intervalMonths * ordinal, 1));
  const lastDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  month.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return month;
}

export function canScheduleFrom(invoice: Pick<Invoice, "direction" | "documentType" | "documentStatus" | "legalEntity" | "clientId" | "finalizedAt" | "currency">) {
  return invoice.direction === "VYDANA" && invoice.documentType === "INVOICE" && invoice.documentStatus === "ISSUED" &&
    invoice.currency === "EUR" && !!invoice.clientId && !!invoice.finalizedAt && (invoice.legalEntity === "KURGI" || invoice.legalEntity === "SOLE_TRADER");
}

export async function createRecurringSchedule(raw: z.input<typeof recurringInputSchema>, actorId: string) {
  const input = recurringInputSchema.parse(raw);
  const startDate = new Date(input.startDate);
  const source = await prisma.invoice.findUnique({ where: { id: input.sourceInvoiceId } });
  if (!source || !canScheduleFrom(source)) throw new Error("Vyberte vystavenú faktúru v EUR s priradeným odberateľom.");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1::int FROM pg_advisory_xact_lock(hashtext(${`recurring:${input.submissionKey}`}))`;
    const prior = await tx.recurringInvoiceSchedule.findUnique({ where: { submissionKey: input.submissionKey } });
    if (prior) {
      if (prior.createdById !== actorId) throw new Error("Plán nepatrí k tejto požiadavke.");
      return prior;
    }
    const schedule = await tx.recurringInvoiceSchedule.create({ data: {
      submissionKey: input.submissionKey, sourceInvoiceId: source.id, title: input.title,
      startDate, nextDate: startDate, intervalMonths: input.intervalMonths, dueDays: input.dueDays,
      maxCount: input.maxCount, createdById: actorId,
    } });
    await tx.auditLog.create({ data: {
      action: "RECURRING_SCHEDULE_CREATED", entityType: "RecurringInvoiceSchedule", entityId: schedule.id, actorId,
      metadata: { sourceInvoiceId: source.id, startDate: input.startDate, intervalMonths: input.intervalMonths },
    } });
    return schedule;
  });
}

export async function setRecurringPaused(id: string, paused: boolean, actorId: string) {
  await prisma.$transaction(async tx => {
    await tx.recurringInvoiceSchedule.update({ where: { id }, data: { paused } });
    await tx.auditLog.create({ data: {
      action: paused ? "RECURRING_PAUSED" : "RECURRING_RESUMED", entityType: "RecurringInvoiceSchedule", entityId: id, actorId,
    } });
  });
}

export async function generateNextRecurringDraft(id: string, today = todaySlovakia(), expectedDate?: Date) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "RecurringInvoiceSchedule" WHERE "id" = ${id} FOR UPDATE`);
    const schedule = await tx.recurringInvoiceSchedule.findUnique({ where: { id }, include: {
      sourceInvoice: { include: {
        client: { select: { isActive: true } },
        items: { orderBy: { lineNumber: "asc" }, include: { product: { select: { isActive: true } } } },
      } },
    } });
    if (!schedule || schedule.paused || !schedule.nextDate || schedule.nextDate > today) return null;
    if (expectedDate && expectedDate.getTime() !== schedule.nextDate.getTime()) return null;
    const actor = await tx.user.findUnique({ where: { id: schedule.createdById }, select: { role: true } });
    if (!actor || !hasFinancePermission(actor.role, "CREATE_DRAFT")) throw new Error("Tvorca plánu už nemá oprávnenie vytvárať koncepty.");
    const source = schedule.sourceInvoice;
    if (!canScheduleFrom(source) || !source.clientId || !source.client?.isActive ||
      source.items.some(item => item.productId && !item.product?.isActive)) throw new Error("Skontrolujte vzorovú faktúru, odberateľa a produkty.");
    const legalEntity = source.legalEntity === "KURGI" ? "KURGI" : "SOLE_TRADER";
    const date = schedule.nextDate;
    const dueDate = new Date(date.getTime() + schedule.dueDays * 86_400_000);
    const productIds = source.items.map(row => row.productId).filter((id): id is string => !!id);
    const [company, rates] = await Promise.all([
      tx.companyProfile.findFirst({
        where: { legalEntity, isActive: true, validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
        orderBy: { validFrom: "desc" },
        include: { taxProfiles: { where: { validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
          orderBy: { validFrom: "desc" }, take: 1 } },
      }),
      productIds.length ? tx.productVatRate.findMany({
        where: { productId: { in: productIds }, validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
        orderBy: { validFrom: "desc" },
      }) : [],
    ]);
    const tax = company?.taxProfiles[0];
    if (!tax) throw new Error("Pre obdobie plánu chýba daňový profil vystavovateľa.");
    const payer = isVatPayerAtDate(tax.vatStatus, tax.vatRegisteredFrom, date);
    const invoice = await invoiceService.createDraftInTransaction(tx, {
      direction: "VYDANA", clientId: source.clientId, currency: "EUR", legalEntity,
      actorId: schedule.createdById, issueDate: date, deliveryDate: date, dueDate, note: source.note ?? undefined,
      items: source.items.map(row => {
        const rate = rates.find(item => item.productId === row.productId);
        return { description: row.description, productId: row.productId ?? undefined, productSku: row.productSku ?? undefined,
          quantity: row.quantity, unit: row.unit, unitPriceCents: row.unitPriceCents, unitPriceExact: row.unitPriceExact?.toString(),
          vatRate: payer ? rate?.confirmedAt ? rate.rate : row.vatRate : 0,
        };
      }),
    });
    await tx.recurringInvoiceRun.create({ data: { scheduleId: id, occurrence: date, invoiceId: invoice.id } });
    const count = schedule.generatedCount + 1;
    const nextDate = schedule.maxCount && count >= schedule.maxCount ? null : scheduledOccurrence(schedule.startDate, schedule.intervalMonths, count);
    await tx.recurringInvoiceSchedule.update({ where: { id }, data: { generatedCount: count, nextDate } });
    return invoice;
  });
}

export async function generateDueRecurringDrafts() {
  const today = todaySlovakia();
  const schedules = await prisma.recurringInvoiceSchedule.findMany({
    where: { paused: false, nextDate: { lte: today } }, orderBy: { nextDate: "asc" }, take: 50, select: { id: true },
  });
  const counts = { generated: 0, failed: 0 };
  for (const schedule of schedules) {
    try {
      if (await generateNextRecurringDraft(schedule.id, today)) counts.generated++;
    } catch {
      counts.failed++;
      console.error("Pravidelný koncept sa nepodarilo vytvoriť.", schedule.id);
    }
  }
  return counts;
}
