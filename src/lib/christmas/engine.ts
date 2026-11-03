import { Prisma } from "@prisma/client";

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const ZERO = D(0);
const cents = (value: Prisma.Decimal) => value.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.add(b), ZERO);

export type Sku = "GINGER_60" | "GINGER_200" | "PINEAPPLE_60" | "PINEAPPLE_200";
export type Origin = "AGENCY" | "OWN" | "UNKNOWN";
export type CostKey = "ginger" | "lemon" | "honey" | "pineapple" | "cinnamon" | "water";
export type CampaignConfiguration = {
  prices: { thresholds: { min: number; discount: string; net60: string; net200: string }[]; retailGross60: string; retailGross200: string; thresholdMode: "TOTAL_SHOTS" };
  costs: {
    ingredients: Record<CostKey, { purchase: string; vatRate: string; deductible: boolean; yieldMl?: string; densityKgPerL?: string }>;
    bottle60: string; bottle200: string; cap: string; label60: string; label200: string;
    ingredientYieldFactor: string; pasteurizationKwh: string; electricityPerKwh: string; pasteurizationLiters: string;
    monthlyOverhead: Record<string, string>; benchmarkLiters: string;
    cap200CompatibilityConfirmed: boolean;
  };
  recipes: Record<"GINGER" | "PINEAPPLE", { ginger: string; lemon: string; honey: string; pineapple: string; water: string; cinnamonGramsPerLiter: string }>;
  outputVatRate: string;
  splitRate: string;
  sweetenedDrinkTaxStatus: "UNCONFIRMED" | "NOT_APPLICABLE" | "APPLICABLE";
};

export const APPROVED_CONFIG: CampaignConfiguration = {
  prices: {
    thresholds: [
      { min: 100, discount: "5", net60: "1.93", net200: "6.95" },
      { min: 200, discount: "7.5", net60: "1.88", net200: "6.77" },
      { min: 300, discount: "10", net60: "1.83", net200: "6.59" },
      { min: 500, discount: "12.5", net60: "1.78", net200: "6.40" },
      { min: 800, discount: "17.5", net60: "1.68", net200: "6.04" },
      { min: 1000, discount: "20", net60: "1.63", net200: "5.85" },
    ], retailGross60: "2.50", retailGross200: "9.00", thresholdMode: "TOTAL_SHOTS",
  },
  costs: {
    ingredients: {
      ginger: { purchase: "3.00", vatRate: "19", deductible: true, yieldMl: "800" },
      lemon: { purchase: "2.60", vatRate: "19", deductible: true, yieldMl: "500" },
      honey: { purchase: "3.50", vatRate: "0", deductible: false, densityKgPerL: "1.43" },
      pineapple: { purchase: "3.00", vatRate: "19", deductible: true, yieldMl: "450" },
      cinnamon: { purchase: "26.92", vatRate: "19", deductible: true },
      water: { purchase: "0", vatRate: "0", deductible: false },
    },
    bottle60: "0.19420", bottle200: "0.20600", cap: "0.08218", label60: "0.07072", label200: "0.18399",
    ingredientYieldFactor: "0.98", pasteurizationKwh: "3.5", electricityPerKwh: "0.20", pasteurizationLiters: "30",
    monthlyOverhead: { ownerLabor: "1000", rent: "250", ordinaryElectricity: "20", sanitation: "2.50", equipmentReserve: "47.62", accounting: "100", bank: "5", superFaktura: "6", ai: "20", hosting: "5", domain: "0.83", ownMarketing: "100", carFuel: "35" },
    benchmarkLiters: "150", cap200CompatibilityConfirmed: false,
  },
  recipes: {
    GINGER: { ginger: "0.35", lemon: "0.20", honey: "0.20", pineapple: "0", water: "0.25", cinnamonGramsPerLiter: "0" },
    PINEAPPLE: { ginger: "0.20", lemon: "0.20", honey: "0.10", pineapple: "0.25", water: "0.25", cinnamonGramsPerLiter: "2.5" },
  },
  outputVatRate: "23", splitRate: "50", sweetenedDrinkTaxStatus: "UNCONFIRMED",
};

export type CalculationInput = {
  origin: Origin;
  items: { sku: Sku; quantity: number; manualUnitNet?: string; priceReason?: string; vatRate?: string }[];
  packages: { name: string; kind: string; quantity: number; contents: { sku: Sku; quantityPerPackage: number }[]; brandingDescription?: string; unitMaterialCost?: string | null; materialVatRate?: string; materialVatDeductible?: boolean; unitBrandingCost?: string | null; unitLaborCost?: string | null; unitWasteCost?: string | null; unitRevenueNet?: string | null; vatRate?: string; costsConfirmed: boolean }[];
  extraCosts: { name: string; category: string; quantity: string; unit: string; unitPurchasePrice?: string | null; vatRate: string; vatDeductible: boolean; includeInProfit: boolean; confirmedNoCost?: boolean; note?: string }[];
  revenues: { name: string; category: string; quantity: string; unitNet: string; vatRate: string }[];
  assignedAdNet?: string;
};

const volume = (sku: Sku) => sku.endsWith("_60") ? D("0.06") : D("0.2");
const recipe = (sku: Sku) => sku.startsWith("GINGER") ? "GINGER" : "PINEAPPLE";
const netPurchase = (purchase: string, vatRate: string, deductible: boolean) => deductible ? D(purchase).div(D(1).add(D(vatRate).div(100))) : D(purchase);

export function calculateUnitCost(sku: Sku, config: CampaignConfiguration = APPROVED_CONFIG) {
  const c = config.costs;
  const r = config.recipes[recipe(sku)];
  if (!sum([D(r.ginger), D(r.lemon), D(r.honey), D(r.pineapple), D(r.water)]).eq(1)) throw new Error("Tekuté zložky receptúry musia tvoriť 100 %.");
  const liters = volume(sku);
  const ingredient = (key: CostKey, ratio: string) => {
    const part = c.ingredients[key];
    const net = netPurchase(part.purchase, part.vatRate, part.deductible);
    if (key === "honey") return liters.mul(ratio).mul(part.densityKgPerL ?? "0").mul(net);
    return liters.mul(1000).mul(ratio).div(part.yieldMl ?? "1").mul(net);
  };
  const ginger = ingredient("ginger", r.ginger), lemon = ingredient("lemon", r.lemon);
  const honey = ingredient("honey", r.honey), pineapple = ingredient("pineapple", r.pineapple);
  const cinnamonPart = c.ingredients.cinnamon;
  const cinnamon = liters.mul(r.cinnamonGramsPerLiter).div(1000).mul(netPurchase(cinnamonPart.purchase, cinnamonPart.vatRate, cinnamonPart.deductible));
  const water = liters.mul(r.water).mul(c.ingredients.water.purchase);
  const ingredientsBeforeLoss = sum([ginger, lemon, honey, pineapple, cinnamon, water]);
  const productionLoss = ingredientsBeforeLoss.div(c.ingredientYieldFactor).sub(ingredientsBeforeLoss);
  const bottle = D(sku.endsWith("_60") ? c.bottle60 : c.bottle200);
  const cap = D(c.cap), label = D(sku.endsWith("_60") ? c.label60 : c.label200);
  const pasteurization = liters.mul(c.pasteurizationKwh).mul(c.electricityPerKwh).div(c.pasteurizationLiters);
  const overhead = liters.mul(sum(Object.values(c.monthlyOverhead).map(D))).div(c.benchmarkLiters);
  const direct = sum([ingredientsBeforeLoss, productionLoss, bottle, cap, label, pasteurization]);
  return { raw: { ginger, lemon, honey, pineapple, cinnamon, water, productionLoss, bottle, cap, label, pasteurization, overhead, direct, allIn: direct.add(overhead) },
    display: { direct: cents(direct), overhead: cents(overhead), allIn: cents(direct.add(overhead)) } };
}

export function calculate(input: CalculationInput, config: CampaignConfiguration = APPROVED_CONFIG) {
  const totalShots = input.items.reduce((n, i) => n + i.quantity, 0);
  const threshold = [...config.prices.thresholds].reverse().find(t => totalShots >= t.min) ?? null;
  const breakdown: Record<string, Prisma.Decimal> = Object.fromEntries(["ginger", "lemon", "honey", "pineapple", "cinnamon", "water", "productionLoss", "bottle", "cap", "label", "pasteurization", "overhead"].map(k => [k, ZERO]));
  const vatByRate = new Map<string, Prisma.Decimal>();
  const addVat = (net: Prisma.Decimal, rate: string) => vatByRate.set(rate, (vatByRate.get(rate) ?? ZERO).add(net.mul(rate).div(100)));
  let productRevenue = ZERO, packageRevenue = ZERO, serviceRevenue = ZERO, discount = ZERO;
  const rows = input.items.map((item) => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error("Počet shotov musí byť kladné celé číslo.");
    if (!(["GINGER_60", "GINGER_200", "PINEAPPLE_60", "PINEAPPLE_200"] as string[]).includes(item.sku)) throw new Error("Neznámy variant shotu.");
    if (!threshold && !item.manualUnitNet) throw new Error("Pod 100 shotov je potrebné ručne schváliť jednotkovú cenu.");
    if (item.manualUnitNet && !item.priceReason?.trim()) throw new Error("Individuálna cena vyžaduje dôvod.");
    const listed = threshold ? D(item.sku.endsWith("_60") ? threshold.net60 : threshold.net200) : null;
    const unitNet = item.manualUnitNet ? D(item.manualUnitNet) : listed!;
    if (unitNet.isNegative()) throw new Error("Predajná cena nesmie byť záporná.");
    const net = unitNet.mul(item.quantity);
    const rate = item.vatRate ?? config.outputVatRate;
    productRevenue = productRevenue.add(net); addVat(net, rate);
    const retailNet = D(item.sku.endsWith("_60") ? config.prices.retailGross60 : config.prices.retailGross200)
      .div(D(1).add(D(rate).div(100)));
    if (retailNet.greaterThan(unitNet)) discount = discount.add(retailNet.sub(unitNet).mul(item.quantity));
    const unit = calculateUnitCost(item.sku, config);
    for (const [key, raw] of Object.entries(unit.raw)) if (key in breakdown) breakdown[key] = breakdown[key].add(raw.mul(item.quantity));
    return { sku: item.sku, quantity: item.quantity, threshold: threshold?.min ?? null, listUnitNet: listed?.toString() ?? null, unitNet: unitNet.toString(), vatRate: rate,
      revenueNetCents: cents(net), vatCents: cents(net.mul(rate).div(100)), revenueGrossCents: cents(net.add(net.mul(rate).div(100))),
      directCostCents: cents(unit.raw.direct.mul(item.quantity)), overheadCents: cents(unit.raw.overhead.mul(item.quantity)), allInCostCents: cents(unit.raw.allIn.mul(item.quantity)), contributionCents: cents(net.sub(unit.raw.allIn.mul(item.quantity))) };
  });
  const tally = new Map<string, number>();
  for (const i of input.items) tally.set(i.sku, (tally.get(i.sku) ?? 0) + i.quantity);
  let packageCosts = ZERO;
  let packageProfit = ZERO;
  const missing: string[] = [];
  for (const p of input.packages) {
    if (!Number.isSafeInteger(p.quantity) || p.quantity <= 0) throw new Error("Počet balení musí byť kladné celé číslo.");
    if (p.contents.length === 0) missing.push(`${p.name}: obsah balenia`);
    for (const content of p.contents) {
      if (!Number.isSafeInteger(content.quantityPerPackage) || content.quantityPerPackage <= 0) throw new Error("Obsah balenia musí mať kladný počet shotov.");
      tally.set(content.sku, (tally.get(content.sku) ?? 0) - content.quantityPerPackage * p.quantity);
    }
    for (const key of ["unitMaterialCost", "unitBrandingCost", "unitLaborCost", "unitWasteCost", "unitRevenueNet"] as const) if (p[key] == null || p[key] === "") missing.push(`${p.name}: ${key}`);
    if (!p.costsConfirmed) missing.push(`${p.name}: potvrdenie nákladov`);
    const materialCost = p.materialVatDeductible ? D(p.unitMaterialCost || 0).div(D(1).add(D(p.materialVatRate ?? "0").div(100))) : D(p.unitMaterialCost || 0);
    const cost = sum([materialCost, ...[p.unitBrandingCost, p.unitLaborCost, p.unitWasteCost].map(x => D(x || 0))]).mul(p.quantity);
    packageCosts = packageCosts.add(cost);
    const net = D(p.unitRevenueNet || 0).mul(p.quantity);
    packageRevenue = packageRevenue.add(net); addVat(net, p.vatRate ?? config.outputVatRate);
    let containedShotProfit = ZERO;
    for (const content of p.contents) {
      const matching = rows.filter(row => row.sku === content.sku);
      const count = matching.reduce((n, row) => n + row.quantity, 0);
      if (count > 0) {
        const averagePrice = sum(matching.map(row => D(row.unitNet).mul(row.quantity))).div(count);
        const unitAllIn = calculateUnitCost(content.sku, config).raw.allIn;
        containedShotProfit = containedShotProfit.add(averagePrice.sub(unitAllIn).mul(content.quantityPerPackage).mul(p.quantity));
      }
    }
    packageProfit = packageProfit.add(containedShotProfit).add(net).sub(cost);
  }
  if ([...tally.values()].some(n => n < 0)) throw new Error("Balenia obsahujú viac shotov než produktové riadky.");
  let extraCosts = ZERO;
  const costRows = input.extraCosts.map(e => {
    if (e.category === "CAMPAIGN_AD") throw new Error("Reklamu evidujte samostatne, mimo deliteľného zisku.");
    if ((e.unitPurchasePrice == null || e.unitPurchasePrice === "") && !e.confirmedNoCost) missing.push(`${e.name}: jednotkový náklad`);
    const gross = D(e.unitPurchasePrice || 0).mul(e.quantity);
    if (gross.isNegative() || D(e.quantity).isNegative()) throw new Error("Náklad a množstvo nesmú byť záporné.");
    const net = e.vatDeductible ? gross.div(D(1).add(D(e.vatRate).div(100))) : gross;
    if (e.includeInProfit) extraCosts = extraCosts.add(net);
    return { name: e.name, category: e.category, netCostCents: cents(net), included: e.includeInProfit };
  });
  for (const revenue of input.revenues) {
    const net = D(revenue.quantity).mul(revenue.unitNet);
    if (net.isNegative()) throw new Error("Výnos nesmie byť záporný.");
    serviceRevenue = serviceRevenue.add(net); addVat(net, revenue.vatRate);
  }
  const direct = sum(["ginger", "lemon", "honey", "pineapple", "cinnamon", "water", "productionLoss", "bottle", "cap", "label", "pasteurization"].map(k => breakdown[k]));
  const overhead = breakdown.overhead;
  const netRevenue = productRevenue.add(packageRevenue).add(serviceRevenue);
  // DPH sa uzatvára po sadzbách. Súčet zobrazených sadzieb sa tak vždy rovná celkovej DPH.
  const vatByRateCents = Object.fromEntries([...vatByRate].map(([rate, amount]) => [rate, cents(amount)]));
  const vatCents = Object.values(vatByRateCents).reduce((total, amount) => total + amount, 0);
  const divisible = netRevenue.sub(direct).sub(overhead).sub(packageCosts).sub(extraCosts);
  const profitCents = cents(divisible);
  const agencyShareCents = input.origin === "AGENCY" && profitCents > 0
    ? D(profitCents).mul(config.splitRate).div(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber()
    : 0;
  const unallocatedProfitCents = input.origin === "UNKNOWN" && profitCents > 0 ? profitCents : 0;
  const companyShareCents = profitCents - agencyShareCents - unallocatedProfitCents;
  const assignedAdCents = cents(D(input.assignedAdNet ?? 0));
  const margin = (profit: Prisma.Decimal) => netRevenue.isZero() ? null : profit.div(netRevenue).mul(100).toFixed(2);
  return {
    totalShots, totalPackages: input.packages.reduce((n, p) => n + p.quantity, 0), threshold: threshold?.min ?? null,
    productRevenueCents: cents(productRevenue), packageRevenueCents: cents(packageRevenue), serviceRevenueCents: cents(serviceRevenue),
    revenueNetCents: cents(netRevenue), vatCents, revenueGrossCents: cents(netRevenue) + vatCents,
    vatByRateCents, discountCents: cents(discount),
    ingredientBreakdownCents: Object.fromEntries(Object.entries(breakdown).map(([key, val]) => [key, cents(val)])),
    directCostCents: cents(direct), overheadCents: cents(overhead), packageCostCents: cents(packageCosts), extraCostCents: cents(extraCosts),
    otherCostCents: cents(packageCosts.add(extraCosts)), allInCostCents: cents(direct.add(overhead).add(packageCosts).add(extraCosts)),
    grossContributionCents: cents(netRevenue.sub(direct)), directMarginPct: margin(netRevenue.sub(direct)),
    divisibleProfitCents: profitCents, allInMarginPct: margin(divisible), agencyShareCents, companyShareCents,
    unallocatedProfitCents, assignedAdCents, effectiveCompanyCents: companyShareCents - assignedAdCents,
    profitPerShotCents: totalShots ? cents(divisible.div(totalShots)) : null,
    profitPerPackageCents: input.packages.length && input.packages.reduce((n, p) => n + p.quantity, 0) ? cents(packageProfit.div(input.packages.reduce((n, p) => n + p.quantity, 0))) : null,
    loss: profitCents < 0, attributionPending: input.origin === "UNKNOWN", missing, rows, costRows,
  };
}
