import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isCommercialChristmasOrder } from "./status";

const cents = (n: Prisma.Decimal) => n.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
export function adNetCents(ad: { amount: Prisma.Decimal; vatRate: Prisma.Decimal; vatDeductible: boolean }) {
  return cents(ad.vatDeductible ? ad.amount.div(new Prisma.Decimal(1).add(ad.vatRate.div(100))) : ad.amount);
}
export type DashboardFilters = { origin?: string; status?: string; clientId?: string; from?: Date; to?: Date; sku?: string; packageKind?: string };
export async function campaignDashboard(campaignId: string, filters: DashboardFilters = {}) {
  const where: Prisma.ChristmasOrderWhereInput = {
    campaignId, legalEntity: "KURGI",
    ...(filters.origin ? { origin: filters.origin } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.clientId ? { clientId: filters.clientId } : {}),
    ...(filters.from || filters.to ? { createdAt: { gte: filters.from, lte: filters.to } } : {}),
  };
  const [allOrders, ads] = await Promise.all([
    prisma.christmasOrder.findMany({ where, include: { client: { select: { name: true } }, attribution: true, snapshots: { orderBy: { revision: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" } }),
    prisma.christmasAdExpense.findMany({ where: { campaignId, voidedAt: null, ...(filters.from || filters.to ? { spentAt: { gte: filters.from, lte: filters.to } } : {}) } }),
  ]);
  const orders = allOrders.filter(o => {
    const input = o.snapshots[0]?.input as { items?: { sku: string }[]; packages?: { kind: string }[] } | undefined;
    return (!filters.sku || input?.items?.some(i => i.sku === filters.sku)) &&
      (!filters.packageKind || input?.packages?.some(p => p.kind === filters.packageKind));
  });
  const commercial = orders.filter(isCommercialChristmasOrder);
  const sum = (key: "revenueNetCents" | "revenueGrossCents" | "directCostCents" | "overheadCents" | "otherCostCents" | "divisibleProfitCents" | "agencyShareCents" | "companyShareCents") => commercial.reduce((n, o) => n + (o.snapshots[0]?.[key] ?? 0), 0);
  const hasOrderFilter = Boolean(filters.origin || filters.status || filters.clientId || filters.sku || filters.packageKind);
  const selectedAds = ads.filter(a => hasOrderFilter ? Boolean(a.orderId && orders.some(o => o.id === a.orderId)) : true);
  const attributedAd = selectedAds.filter(a => a.orderId).reduce((n, a) => n + adNetCents(a), 0);
  const unassignedAd = selectedAds.filter(a => !a.orderId).reduce((n, a) => n + adNetCents(a), 0);
  const adTotal = attributedAd + unassignedAd;
  const origin = Object.fromEntries(["AGENCY", "OWN", "UNKNOWN"].map(kind => {
    const rows = commercial.filter(o => o.origin === kind);
    return [kind, { count: rows.length, profitCents: rows.reduce((n, o) => n + (o.snapshots[0]?.divisibleProfitCents ?? 0), 0), agencyCents: rows.reduce((n, o) => n + (o.snapshots[0]?.agencyShareCents ?? 0), 0) }];
  }));
  const shots = commercial.reduce((n, o) => n + ((o.snapshots[0]?.result as { totalShots?: number } | undefined)?.totalShots ?? 0), 0);
  const packages = commercial.reduce((n, o) => n + ((o.snapshots[0]?.result as { totalPackages?: number } | undefined)?.totalPackages ?? 0), 0);
  const liters = commercial.reduce((n, o) => {
    const items = (o.snapshots[0]?.input as { items?: { sku: string; quantity: number }[] } | undefined)?.items ?? [];
    return n + items.reduce((m, i) => m + i.quantity * (i.sku.endsWith("_60") ? 0.06 : 0.2), 0);
  }, 0);
  return { orders, ads, stats: {
    leadCount: orders.filter(o => o.attribution?.leadId).length,
    calculationCount: orders.length,
    quoteSentCount: orders.filter(o => ["QUOTE_SENT", "CONFIRMED", "INVOICED", "PAID"].includes(o.status)).length,
    confirmedCount: commercial.length,
    paidCount: orders.filter(o => o.status === "PAID" && o.paidAt && !o.refundedAt).length,
    cancelledCount: orders.filter(o => o.status === "CANCELLED").length,
    shots, packages, liters,
    revenueNetCents: sum("revenueNetCents"), revenueGrossCents: sum("revenueGrossCents"),
    directCostCents: sum("directCostCents"), overheadCents: sum("overheadCents"), otherCostCents: sum("otherCostCents"),
    divisibleProfitCents: sum("divisibleProfitCents"), agencyShareCents: sum("agencyShareCents"), companyShareCents: sum("companyShareCents"),
    adTotalCents: adTotal, attributedAdCents: attributedAd, unassignedAdCents: unassignedAd,
    effectiveCompanyCents: sum("companyShareCents") - adTotal, origin,
  } };
}
