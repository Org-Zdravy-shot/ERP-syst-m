"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { calculate, APPROVED_CONFIG, type CampaignConfiguration, type CalculationInput } from "@/lib/christmas/engine";
import { calculationInputSchema, saveSchema, statusSchema, isoDate } from "@/lib/christmas/validation";
import { initialVersionData, validateConfig } from "@/lib/christmas/config";
import { canTransitionChristmasOrder, isSettlementEligible } from "@/lib/christmas/status";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const d = (value: string | null | undefined) => value == null || value === "" ? null : new Prisma.Decimal(value);
const allowedEntity = "KURGI";

async function campaignFor(id: string) {
  const campaign = await prisma.christmasCampaign.findFirst({ where: { id, legalEntity: allowedEntity } });
  if (!campaign) throw new Error("Kampaň neexistuje alebo k nej nemáte prístup.");
  return campaign;
}

export async function getConfiguration(campaignId: string) {
  await requireFinancePermission("VIEW");
  await campaignFor(campaignId);
  const [pricing, costs, recipes, settings] = await Promise.all([
    prisma.christmasPricingVersion.findFirst({ where: { campaignId }, orderBy: { version: "desc" } }),
    prisma.christmasCostVersion.findFirst({ where: { campaignId }, orderBy: { version: "desc" } }),
    prisma.christmasRecipeVersion.findFirst({ where: { campaignId }, orderBy: { version: "desc" } }),
    prisma.christmasCampaignSettings.findUnique({ where: { campaignId } }),
  ]);
  if (!pricing || !costs || !recipes || !settings) throw new Error("Kampaň nemá úplnú konfiguráciu.");
  const config = validateConfig({ prices: pricing.data, costs: costs.data, recipes: recipes.data, outputVatRate: settings.outputVatRate.toString(), splitRate: settings.splitRate.toString(), sweetenedDrinkTaxStatus: settings.sweetenedDrinkTaxStatus } as CampaignConfiguration);
  return { config, ids: { pricing: pricing.id, costs: costs.id, recipes: recipes.id }, versions: { pricing: pricing.version, costs: costs.version, recipes: recipes.version } };
}

export async function createCampaign2026() {
  const actor = await requireFinancePermission("CONFIGURE");
  const existing = await prisma.christmasCampaign.findFirst({ where: { legalEntity: allowedEntity, year: 2026, name: "Vianočná B2B kampaň 2026" } });
  if (existing) redirect(`/vianocna-b2b?kampan=${existing.id}`);
  const campaign = await prisma.$transaction(async tx => {
    const c = await tx.christmasCampaign.create({ data: { legalEntity: allowedEntity, year: 2026, name: "Vianočná B2B kampaň 2026", settings: { create: { outputVatRate: new Prisma.Decimal("23"), splitRate: new Prisma.Decimal("50") } }, pricingVersions: { create: { version: 1, data: initialVersionData.pricing, reason: "Schválený cenník október 2026", createdById: actor.userId } }, costVersions: { create: { version: 1, data: initialVersionData.costs, reason: "Schválené vstupné náklady 2026", createdById: actor.userId } }, recipeVersions: { create: { version: 1, data: initialVersionData.recipes, reason: "Schválené receptúry 2026", createdById: actor.userId } } } });
    await tx.christmasAuditLog.create({ data: { campaignId: c.id, actorId: actor.userId, action: "CAMPAIGN_CREATED" } });
    return c;
  });
  revalidatePath("/vianocna-b2b");
  redirect(`/vianocna-b2b?kampan=${campaign.id}`);
}

export async function previewCalculation(campaignId: string, raw: unknown) {
  await requireFinancePermission("VIEW");
  const input = calculationInputSchema.parse(raw);
  const { config } = await getConfiguration(campaignId);
  return calculate({ ...input, assignedAdNet: "0" } as CalculationInput, config);
}

export async function saveCalculation(raw: unknown) {
  const actor = await requireFinancePermission("CREATE_DRAFT");
  const data = saveSchema.parse(raw);
  const campaign = await campaignFor(data.campaignId);
  if (campaign.status !== "OPEN") throw new Error("Uzavretú kampaň nemožno meniť.");
  const client = await prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true, type: true } });
  if (!client || client.type !== "B2B") throw new Error("Vyberte existujúceho firemného klienta.");
  const { config, ids } = await getConfiguration(data.campaignId);
  const input = data.input as CalculationInput;
  const result = calculate(input, config);
  const orderId = await prisma.$transaction(async tx => {
    let order;
    if (data.orderId) {
      order = await tx.christmasOrder.findFirst({ where: { id: data.orderId, campaignId: data.campaignId, legalEntity: allowedEntity } });
      if (!order) throw new Error("Kalkulácia nepatrí do tejto kampane.");
      if (order.currentRevision !== data.expectedRevision) throw new Error("Kalkulácia sa medzičasom zmenila. Obnovte stránku.");
      if (order.status !== "DRAFT") throw new Error("Upravovať možno iba rozpracovanú kalkuláciu. Na nové náklady použite prepočet do novej revízie.");
    } else {
      const existing = await tx.christmasOrder.findUnique({ where: { submissionKey: data.submissionKey } });
      if (existing) {
        if (existing.campaignId !== data.campaignId) throw new Error("Kľúč uloženia patrí inej kampani.");
        return existing.id;
      }
      const counter = await tx.docCounter.upsert({ where: { id: `VIANOCE-K-${campaign.year}` }, create: { id: `VIANOCE-K-${campaign.year}`, lastNumber: 1 }, update: { lastNumber: { increment: 1 } } });
      order = await tx.christmasOrder.create({ data: { campaignId: campaign.id, legalEntity: allowedEntity, number: `VB2B${campaign.year}-${String(counter.lastNumber).padStart(4, "0")}`, submissionKey: data.submissionKey, clientId: data.clientId, origin: input.origin } });
    }
    const revision = order.currentRevision + 1;
    const beforeOrigin = order.origin;
    await tx.christmasOrder.update({ where: { id: order.id }, data: { clientId: data.clientId, contactName: data.contactName || null, deliveryDate: data.deliveryDate ? new Date(`${data.deliveryDate}T12:00:00Z`) : null, note: data.note || null, origin: input.origin, currentRevision: revision } });
    await tx.christmasLeadAttribution.upsert({ where: { orderId_campaignId: { orderId: order.id, campaignId: campaign.id } }, create: { orderId: order.id, campaignId: campaign.id, leadId: data.leadId || null, source: data.source || null, sourceCampaign: data.sourceCampaign || null, crmReference: data.crmReference || null, note: data.attributionNote || null }, update: { leadId: data.leadId || null, source: data.source || null, sourceCampaign: data.sourceCampaign || null, crmReference: data.crmReference || null, note: data.attributionNote || null } });
    if (input.items.length) await tx.christmasOrderItem.createMany({ data: input.items.map((i, index) => ({ orderId: order.id, campaignId: campaign.id, revision, sku: i.sku, quantity: i.quantity, listUnitNet: d(result.rows[index].listUnitNet), unitNet: d(result.rows[index].unitNet), priceReason: i.priceReason || null, vatRate: new Prisma.Decimal(i.vatRate ?? config.outputVatRate) })) });
    if (input.packages.length) await tx.christmasOrderPackage.createMany({ data: input.packages.map(p => ({ orderId: order.id, campaignId: campaign.id, revision, name: p.name, kind: p.kind, quantity: p.quantity, contents: json(p.contents), brandingDescription: p.brandingDescription || null, unitMaterialCost: d(p.unitMaterialCost), materialVatRate: new Prisma.Decimal(p.materialVatRate ?? "0"), materialVatDeductible: p.materialVatDeductible ?? false, unitBrandingCost: d(p.unitBrandingCost), unitLaborCost: d(p.unitLaborCost), unitWasteCost: d(p.unitWasteCost), unitRevenueNet: d(p.unitRevenueNet), vatRate: new Prisma.Decimal(p.vatRate ?? config.outputVatRate), costsConfirmed: p.costsConfirmed })) });
    if (input.extraCosts.length) await tx.christmasOrderExtraCost.createMany({ data: input.extraCosts.map(e => ({ orderId: order.id, campaignId: campaign.id, revision, name: e.name, category: e.category, quantity: new Prisma.Decimal(e.quantity), unit: e.unit, unitPurchasePrice: d(e.unitPurchasePrice), vatRate: new Prisma.Decimal(e.vatRate), vatDeductible: e.vatDeductible, includeInProfit: e.includeInProfit, confirmedNoCost: e.confirmedNoCost || false, note: e.note || null })) });
    if (input.revenues.length) await tx.christmasOrderRevenue.createMany({ data: input.revenues.map(r => ({ orderId: order.id, campaignId: campaign.id, revision, name: r.name, category: r.category, quantity: new Prisma.Decimal(r.quantity), unitNet: new Prisma.Decimal(r.unitNet), vatRate: new Prisma.Decimal(r.vatRate) })) });
    await tx.christmasCalculationSnapshot.create({ data: { orderId: order.id, campaignId: campaign.id, revision, pricingVersionId: ids.pricing, costVersionId: ids.costs, recipeVersionId: ids.recipes, input: json(input), configuration: json(config), result: json(result), revenueNetCents: result.revenueNetCents, revenueGrossCents: result.revenueGrossCents, directCostCents: result.directCostCents, overheadCents: result.overheadCents, otherCostCents: result.otherCostCents, divisibleProfitCents: result.divisibleProfitCents, agencyShareCents: result.agencyShareCents, companyShareCents: result.companyShareCents, createdById: actor.userId } });
    await tx.christmasAuditLog.create({ data: { campaignId: campaign.id, orderId: order.id, actorId: actor.userId, action: beforeOrigin !== input.origin ? "ORIGIN_CHANGED_AND_CALCULATION_SAVED" : "CALCULATION_SAVED", beforeData: json({ origin: beforeOrigin, revision: order.currentRevision }), afterData: json({ origin: input.origin, revision }) } });
    return order.id;
  });
  revalidatePath("/vianocna-b2b");
  redirect(`/vianocna-b2b/kalkulacie/${orderId}`);
}

export async function changeOrderStatus(campaignId: string, orderId: string, rawStatus: string, formData: FormData) {
  const actor = await requireFinancePermission("FINALIZE");
  const status = statusSchema.parse(rawStatus);
  const evidence = String(formData.get("evidence") ?? "").trim();
  const campaign = await campaignFor(campaignId);
  if (campaign.status !== "OPEN") throw new Error("Kampaň je uzavretá.");
  await prisma.$transaction(async tx => {
    const order = await tx.christmasOrder.findFirst({ where: { id: orderId, campaignId, legalEntity: allowedEntity }, include: { snapshots: { orderBy: { revision: "desc" }, take: 1 } } });
    if (!order || !order.snapshots[0]) throw new Error("Kalkulácia neexistuje.");
    if (!canTransitionChristmasOrder(order.status, status)) throw new Error("Neplatný prechod stavu objednávky.");
    if (["INVOICED", "PAID", "REFUNDED", "CANCELLED"].includes(status) && evidence.length < 3) throw new Error("Pri tomto stave uveďte referenciu alebo dôvod.");
    const result = order.snapshots[0].result as Record<string, unknown>;
    if (status !== "DRAFT" && status !== "CANCELLED" && status !== "REFUNDED") {
      if ((result.missing as string[]).length || (result.totalShots as number) < 1 || order.origin === "UNKNOWN") throw new Error("Pred potvrdením doplňte výrobky, všetky náklady a pôvod zákazníka.");
      const tax = await tx.christmasCampaignSettings.findUniqueOrThrow({ where: { campaignId } });
      if (tax.sweetenedDrinkTaxStatus === "APPLICABLE") throw new Error("Pri potvrdenej dani zo sladených nápojov treba najprv doplniť schválenú sadzbu a klasifikáciu produktov.");
    }
    if (status === "PAID" && order.status !== "INVOICED") throw new Error("Zaplatenie možno potvrdiť po fakturácii.");
    if (status === "REFUNDED" && order.status !== "PAID") throw new Error("Refundovať možno iba zaplatenú objednávku.");
    await tx.christmasOrder.update({ where: { id: order.id }, data: { status, paidAt: status === "PAID" ? new Date() : order.paidAt, paymentReference: status === "PAID" ? evidence : order.paymentReference, invoiceReference: status === "INVOICED" ? evidence : order.invoiceReference, refundedAt: status === "REFUNDED" ? new Date() : order.refundedAt, refundReference: status === "REFUNDED" ? evidence : order.refundReference, cancelledAt: status === "CANCELLED" ? new Date() : order.cancelledAt, cancellationReason: status === "CANCELLED" ? evidence : order.cancellationReason } });
    await tx.christmasAuditLog.create({ data: { campaignId, orderId, actorId: actor.userId, action: "STATUS_CHANGED", beforeData: json({ status: order.status }), afterData: json({ status, evidence }) } });
  });
  revalidatePath(`/vianocna-b2b/kalkulacie/${orderId}`); revalidatePath("/vianocna-b2b");
}

export async function addAdExpense(raw: { submissionKey: string; campaignId: string; orderId?: string; spentAt: string; platform: string; name: string; description?: string; amount: string; vatRate: string; vatDeductible: boolean; supplier?: string; note?: string }) {
  const actor = await requireFinancePermission("CREATE_DRAFT");
  const campaign = await campaignFor(raw.campaignId);
  if (campaign.status !== "OPEN") throw new Error("Kampaň je uzavretá.");
  if (!/^[0-9a-f-]{36}$/i.test(raw.submissionKey)) throw new Error("Neplatný kľúč uloženia.");
  if (!isoDate.safeParse(raw.spentAt).success) throw new Error("Neplatný dátum reklamy.");
  if (!raw.platform.trim() || !raw.name.trim()) throw new Error("Vyplňte platformu a názov reklamy.");
  if (!/^\d+(?:[.,]\d{1,4})?$/.test(raw.amount) || !/^\d+(?:\.\d{1,4})?$/.test(raw.vatRate)) throw new Error("Neplatná suma alebo DPH.");
  if (raw.orderId && !(await prisma.christmasOrder.findFirst({ where: { id: raw.orderId, campaignId: raw.campaignId, legalEntity: allowedEntity } }))) throw new Error("Objednávka nepatrí do kampane.");
  const amount = new Prisma.Decimal(raw.amount.replace(",", "."));
  if (!amount.isFinite() || !amount.greaterThan(0)) throw new Error("Suma reklamy musí byť kladná.");
  await prisma.$transaction(async tx => {
    const prior = await tx.christmasAdExpense.findUnique({ where: { submissionKey: raw.submissionKey } });
    if (prior) { if (prior.campaignId !== raw.campaignId) throw new Error("Kľúč patrí inej kampani."); return; }
    const ad = await tx.christmasAdExpense.create({ data: { submissionKey: raw.submissionKey, campaignId: raw.campaignId, orderId: raw.orderId || null, spentAt: new Date(raw.spentAt), platform: raw.platform.trim().slice(0, 100), name: raw.name.trim().slice(0, 150), description: raw.description?.trim() || null, amount, vatRate: new Prisma.Decimal(raw.vatRate), vatDeductible: raw.vatDeductible, supplier: raw.supplier?.trim() || null, note: raw.note?.trim() || null } });
    await tx.christmasAuditLog.create({ data: { campaignId: raw.campaignId, orderId: raw.orderId || null, actorId: actor.userId, action: "AD_EXPENSE_CREATED", afterData: json({ id: ad.id, amount: amount.toString() }) } });
  });
  revalidatePath("/vianocna-b2b"); revalidatePath("/vianocna-b2b/reklama");
}

export async function createVersion(campaignId: string, kind: "pricing" | "costs" | "recipes", payload: unknown, reason: string) {
  const actor = await requireFinancePermission("CONFIGURE");
  const campaign = await campaignFor(campaignId);
  if (campaign.status !== "OPEN") throw new Error("Kampaň je uzavretá.");
  const current = await getConfiguration(campaignId);
  const config = validateConfig({ ...current.config, [kind === "pricing" ? "prices" : kind]: payload } as CampaignConfiguration);
  if (reason.trim().length < 5) throw new Error("Zadajte dôvod zmeny.");
  await prisma.$transaction(async tx => {
    if (kind === "pricing") await tx.christmasPricingVersion.create({ data: { campaignId, version: current.versions.pricing + 1, data: json(config.prices), reason, createdById: actor.userId } });
    if (kind === "costs") await tx.christmasCostVersion.create({ data: { campaignId, version: current.versions.costs + 1, data: json(config.costs), reason, createdById: actor.userId } });
    if (kind === "recipes") await tx.christmasRecipeVersion.create({ data: { campaignId, version: current.versions.recipes + 1, data: json(config.recipes), reason, createdById: actor.userId } });
    await tx.christmasAuditLog.create({ data: { campaignId, actorId: actor.userId, action: "CONFIG_VERSION_CREATED", afterData: json({ kind, reason }) } });
  });
  revalidatePath("/vianocna-b2b/nastavenia");
}

export async function recalculateWithCurrentCosts(campaignId: string, orderId: string) {
  const actor = await requireFinancePermission("CONFIGURE");
  const campaign = await campaignFor(campaignId);
  if (campaign.status !== "OPEN") throw new Error("Kampaň je uzavretá.");
  const latest = await prisma.christmasCalculationSnapshot.findFirst({ where: { campaignId, orderId }, orderBy: { revision: "desc" } });
  if (!latest) throw new Error("Kalkulácia neexistuje.");
  const { config: currentConfig, ids } = await getConfiguration(campaignId);
  const previousConfig = latest.configuration as CampaignConfiguration;
  const config = validateConfig({ ...previousConfig, costs: currentConfig.costs });
  const input = calculationInputSchema.parse(latest.input);
  const result = calculate(input as CalculationInput, config);
  await prisma.$transaction(async tx => {
    const order = await tx.christmasOrder.findFirst({ where: { id: orderId, campaignId, legalEntity: allowedEntity } });
    if (!order || order.currentRevision !== latest.revision) throw new Error("Kalkulácia sa medzičasom zmenila.");
    if (!["DRAFT", "QUOTE_APPROVED", "QUOTE_SENT"].includes(order.status)) throw new Error("Potvrdenú alebo zaplatenú objednávku nemožno meniť novým prepočtom.");
    const revision = latest.revision + 1;
    if (input.items.length) await tx.christmasOrderItem.createMany({ data: input.items.map((i, index) => ({ orderId, campaignId, revision, sku: i.sku, quantity: i.quantity, listUnitNet: d(result.rows[index].listUnitNet), unitNet: d(result.rows[index].unitNet), priceReason: i.priceReason || null, vatRate: new Prisma.Decimal(i.vatRate ?? config.outputVatRate) })) });
    if (input.packages.length) await tx.christmasOrderPackage.createMany({ data: input.packages.map(p => ({ orderId, campaignId, revision, name: p.name, kind: p.kind, quantity: p.quantity, contents: json(p.contents), brandingDescription: p.brandingDescription || null, unitMaterialCost: d(p.unitMaterialCost), materialVatRate: new Prisma.Decimal(p.materialVatRate ?? "0"), materialVatDeductible: p.materialVatDeductible ?? false, unitBrandingCost: d(p.unitBrandingCost), unitLaborCost: d(p.unitLaborCost), unitWasteCost: d(p.unitWasteCost), unitRevenueNet: d(p.unitRevenueNet), vatRate: new Prisma.Decimal(p.vatRate ?? config.outputVatRate), costsConfirmed: p.costsConfirmed })) });
    if (input.extraCosts.length) await tx.christmasOrderExtraCost.createMany({ data: input.extraCosts.map(e => ({ orderId, campaignId, revision, name: e.name, category: e.category, quantity: new Prisma.Decimal(e.quantity), unit: e.unit, unitPurchasePrice: d(e.unitPurchasePrice), vatRate: new Prisma.Decimal(e.vatRate), vatDeductible: e.vatDeductible, includeInProfit: e.includeInProfit, confirmedNoCost: e.confirmedNoCost || false, note: e.note || null })) });
    if (input.revenues.length) await tx.christmasOrderRevenue.createMany({ data: input.revenues.map(r => ({ orderId, campaignId, revision, name: r.name, category: r.category, quantity: new Prisma.Decimal(r.quantity), unitNet: new Prisma.Decimal(r.unitNet), vatRate: new Prisma.Decimal(r.vatRate) })) });
    await tx.christmasCalculationSnapshot.create({ data: { orderId, campaignId, revision, pricingVersionId: latest.pricingVersionId, costVersionId: ids.costs, recipeVersionId: latest.recipeVersionId, input: json(input), configuration: json(config), result: json(result), revenueNetCents: result.revenueNetCents, revenueGrossCents: result.revenueGrossCents, directCostCents: result.directCostCents, overheadCents: result.overheadCents, otherCostCents: result.otherCostCents, divisibleProfitCents: result.divisibleProfitCents, agencyShareCents: result.agencyShareCents, companyShareCents: result.companyShareCents, createdById: actor.userId } });
    await tx.christmasOrder.update({ where: { id: orderId }, data: { currentRevision: revision } });
    await tx.christmasAuditLog.create({ data: { campaignId, orderId, actorId: actor.userId, action: "RECALCULATED_CURRENT_CONFIG", beforeData: json({ revision: latest.revision }), afterData: json({ revision }) } });
  });
  revalidatePath(`/vianocna-b2b/kalkulacie/${orderId}`);
}

export async function closeSettlement(campaignId: string) {
  const actor = await requireFinancePermission("FINALIZE");
  const campaign = await campaignFor(campaignId);
  if (campaign.status !== "OPEN") throw new Error("Kampaň už je uzavretá.");
  if (!campaign.endsAt || campaign.endsAt.getTime() > Date.now()) throw new Error("Najprv potvrďte skutočný dátum ukončenia kampane v nastaveniach.");
  await prisma.$transaction(async tx => {
    const orders = (await tx.christmasOrder.findMany({ where: { campaignId, legalEntity: allowedEntity, status: "PAID", refundedAt: null, cancelledAt: null, paidAt: { not: null }, origin: "AGENCY" }, include: { client: { select: { name: true } }, snapshots: { orderBy: { revision: "desc" }, take: 1 } } })).filter(isSettlementEligible);
    const rows = orders.map(o => ({ orderId: o.id, number: o.number, client: o.client.name, revision: o.snapshots[0]?.revision, agencyShareCents: o.snapshots[0]?.agencyShareCents ?? 0, companyShareCents: o.snapshots[0]?.companyShareCents ?? 0 }));
    await tx.christmasSettlement.create({ data: { campaignId, includedOrders: json(rows), totalAgencyCents: rows.reduce((n, r) => n + r.agencyShareCents, 0), totalCompanyCents: rows.reduce((n, r) => n + r.companyShareCents, 0), createdById: actor.userId } });
    await tx.christmasCampaign.update({ where: { id: campaignId }, data: { status: "CLOSED" } });
    await tx.christmasAuditLog.create({ data: { campaignId, actorId: actor.userId, action: "SETTLEMENT_CLOSED", afterData: json({ orderCount: rows.length }) } });
  });
  revalidatePath("/vianocna-b2b"); revalidatePath("/vianocna-b2b/vyuctovanie");
}

export async function setCampaignEndDate(campaignId: string, date: string) {
  const actor = await requireFinancePermission("CONFIGURE");
  const campaign = await campaignFor(campaignId);
  if (campaign.status !== "OPEN") throw new Error("Kampaň je uzavretá.");
  if (!isoDate.safeParse(date).success) throw new Error("Neplatný dátum ukončenia.");
  const endsAt = new Date(`${date}T23:59:59Z`);
  await prisma.$transaction(async tx => {
    await tx.christmasCampaign.update({ where: { id: campaignId }, data: { endsAt } });
    await tx.christmasAuditLog.create({ data: { campaignId, actorId: actor.userId, action: "CAMPAIGN_END_DATE_CHANGED", beforeData: json({ endsAt: campaign.endsAt?.toISOString() ?? null }), afterData: json({ endsAt: endsAt.toISOString() }) } });
  });
  revalidatePath("/vianocna-b2b/nastavenia"); revalidatePath("/vianocna-b2b/vyuctovanie");
}

export async function exportDashboardCsv(campaignId: string, filters: { origin?: string; status?: string; clientId?: string; from?: string; to?: string; sku?: string; packageKind?: string }) {
  await requireFinancePermission("EXPORT");
  await campaignFor(campaignId);
  const { campaignDashboard } = await import("@/lib/christmas/dashboard");
  const data = await campaignDashboard(campaignId, { ...filters, from: filters.from ? new Date(filters.from) : undefined, to: filters.to ? new Date(filters.to) : undefined });
  const esc = (v: unknown) => {
    const raw = String(v ?? "");
    const safe = typeof v !== "number" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const columns = ["Číslo", "Klient", "Stav", "Pôvod", "Revízia", "Tržby bez DPH (centy)", "Tržby s DPH (centy)", "Priame náklady (centy)", "Réžia (centy)", "Ostatné náklady (centy)", "Deliteľný zisk (centy)", "Agentúra (centy)", "Zdravý Shot (centy)"];
  return "\uFEFF" + [columns.map(esc).join(";"), ...data.orders.map(o => [o.number, o.client.name, o.status, o.origin, o.snapshots[0]?.revision, o.snapshots[0]?.revenueNetCents, o.snapshots[0]?.revenueGrossCents, o.snapshots[0]?.directCostCents, o.snapshots[0]?.overheadCents, o.snapshots[0]?.otherCostCents, o.snapshots[0]?.divisibleProfitCents, o.snapshots[0]?.agencyShareCents, o.snapshots[0]?.companyShareCents].map(esc).join(";"))].join("\r\n");
}

export async function updateTaxSettings(campaignId: string, outputVatRate: string, sweetenedDrinkTaxStatus: string) {
  const actor = await requireFinancePermission("CONFIGURE");
  const campaign = await campaignFor(campaignId);
  if (campaign.status !== "OPEN") throw new Error("Kampaň je uzavretá.");
  if (!/^\d{1,3}(?:[.,]\d{1,4})?$/.test(outputVatRate)) throw new Error("Neplatná sadzba DPH.");
  if (!["UNCONFIRMED", "NOT_APPLICABLE", "APPLICABLE"].includes(sweetenedDrinkTaxStatus)) throw new Error("Neplatný stav dane zo sladených nápojov.");
  await prisma.$transaction(async tx => {
    const before = await tx.christmasCampaignSettings.findUniqueOrThrow({ where: { campaignId } });
    await tx.christmasCampaignSettings.update({ where: { campaignId }, data: { outputVatRate: new Prisma.Decimal(outputVatRate.replace(",", ".")), sweetenedDrinkTaxStatus } });
    await tx.christmasAuditLog.create({ data: { campaignId, actorId: actor.userId, action: "TAX_SETTINGS_CHANGED", beforeData: json({ outputVatRate: before.outputVatRate.toString(), sweetenedDrinkTaxStatus: before.sweetenedDrinkTaxStatus }), afterData: json({ outputVatRate, sweetenedDrinkTaxStatus }) } });
  });
  revalidatePath("/vianocna-b2b/nastavenia");
}

export async function setCampaignEndDateFromForm(campaignId: string, formData: FormData) {
  await setCampaignEndDate(campaignId, String(formData.get("endsAt") ?? ""));
}

export async function voidAdExpense(campaignId: string, adId: string, formData: FormData) {
  const actor = await requireFinancePermission("CANCEL");
  const campaign = await campaignFor(campaignId);
  if (campaign.status !== "OPEN") throw new Error("Kampaň je uzavretá.");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 5 || reason.length > 500) throw new Error("Zadajte dôvod opravy reklamného výdavku.");
  await prisma.$transaction(async tx => {
    const ad = await tx.christmasAdExpense.findFirst({ where: { id: adId, campaignId, voidedAt: null } });
    if (!ad) throw new Error("Reklamný výdavok neexistuje alebo už bol zrušený.");
    await tx.christmasAdExpense.update({ where: { id: adId }, data: { voidedAt: new Date(), voidReason: reason, voidedById: actor.userId } });
    await tx.christmasAuditLog.create({ data: { campaignId, orderId: ad.orderId, actorId: actor.userId, action: "AD_EXPENSE_VOIDED", beforeData: json({ amount: ad.amount.toString(), orderId: ad.orderId }), afterData: json({ reason }) } });
  });
  revalidatePath("/vianocna-b2b"); revalidatePath("/vianocna-b2b/reklama");
}
