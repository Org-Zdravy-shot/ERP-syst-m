"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseEurToCents } from "@/lib/format";
import { parsePlanDate } from "@/lib/period-reporting";
import { requireFinancePermission } from "@/lib/finance/permissions";

export interface PlanFormState {
  error?: string;
}

export async function upsertPlan(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  await requireFinancePermission("CONFIGURE");

  const year = Number.parseInt(String(formData.get("year") ?? ""), 10);
  const month = Number.parseInt(String(formData.get("month") ?? ""), 10);
  const revenueRaw = String(formData.get("targetRevenue") ?? "").trim();
  const unitsRaw = String(formData.get("targetProductionUnits") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!Number.isInteger(year) || year < 2020 || year > 2100) return { error: "Neplatný rok." };
  if (!Number.isInteger(month) || month < 1 || month > 12) return { error: "Neplatný mesiac." };

  let targetRevenueCents = 0;
  if (revenueRaw) {
    try {
      targetRevenueCents = parseEurToCents(revenueRaw);
    } catch {
      return { error: "Neplatná cieľová suma tržieb." };
    }
  }
  const targetProductionUnits = unitsRaw ? Number.parseInt(unitsRaw, 10) : 0;
  if (Number.isNaN(targetProductionUnits) || targetProductionUnits < 0) {
    return { error: "Neplatný cieľ výroby." };
  }

  await prisma.monthlyPlan.upsert({
    where: { year_month: { year, month } },
    create: { year, month, targetRevenueCents, targetProductionUnits, note },
    update: { targetRevenueCents, targetProductionUnits, note },
  });

  revalidatePath("/plan");
  revalidatePath("/");
  redirect("/plan");
}

export async function savePeriodPlan(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  await requireFinancePermission("CONFIGURE");
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const startDate = parsePlanDate(String(formData.get("startDate") ?? ""));
  const endDate = parsePlanDate(String(formData.get("endDate") ?? ""));
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!name || name.length > 120) return { error: "Zadajte názov plánu (najviac 120 znakov)." };
  if (!startDate || !endDate || endDate < startDate) return { error: "Zadajte platné obdobie od – do." };
  if (endDate.getUTCFullYear() - startDate.getUTCFullYear() > 5) {
    return { error: "Plán môže trvať najviac 5 rokov." };
  }
  if (note && note.length > 1000) return { error: "Poznámka môže mať najviac 1000 znakov." };

  const moneyFields = [
    "targetTurnoverGrossCents", "targetRevenueNetCents", "targetCostsNetCents",
    "targetCashInCents", "targetCashOutCents",
  ] as const;
  const targets = {} as Record<(typeof moneyFields)[number], number>;
  for (const field of moneyFields) {
    const raw = String(formData.get(field) ?? "").trim();
    try {
      const value = raw ? parseEurToCents(raw) : 0;
      if (value < 0) throw new Error("negative");
      targets[field] = value;
    } catch {
      return { error: "Ciele musia byť platné nezáporné sumy v eurách." };
    }
  }
  const productionRaw = String(formData.get("targetProductionUnits") ?? "").trim();
  const targetProductionUnits = productionRaw ? Number(productionRaw) : 0;
  if (!Number.isSafeInteger(targetProductionUnits) || targetProductionUnits < 0) {
    return { error: "Cieľ výroby musí byť nezáporný počet kusov." };
  }
  const data = { name, startDate, endDate, note, ...targets, targetProductionUnits };
  let savedId: string;
  if (id) {
    const existing = await prisma.periodPlan.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return { error: "Plán sa nenašiel. Obnovte stránku." };
    await prisma.periodPlan.update({ where: { id }, data });
    savedId = id;
  } else {
    const created = await prisma.periodPlan.create({ data, select: { id: true } });
    savedId = created.id;
  }
  revalidatePath("/plan");
  redirect(`/plan?plan=${encodeURIComponent(savedId)}`);
}
