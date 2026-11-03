import { describe, expect, it } from "vitest";
import { APPROVED_CONFIG, calculate, calculateUnitCost, type CalculationInput } from "./engine";

const order = (origin: CalculationInput["origin"] = "AGENCY", quantity = 100): CalculationInput => ({ origin, items: [{ sku: "GINGER_60", quantity }], packages: [], extraCosts: [], revenues: [] });
describe("Vianočná B2B ekonomika", () => {
  it("počíta štyri schválené výrobné referencie z detailných vstupov", () => {
    const expected = { GINGER_60: [0.53082, 1.16760], GINGER_200: [1.08457, 3.20717], PINEAPPLE_60: [0.56045, 1.19723], PINEAPPLE_200: [1.18333, 3.30593] } as const;
    for (const [sku, [direct, allIn]] of Object.entries(expected)) {
      const result = calculateUnitCost(sku as keyof typeof expected);
      expect(result.raw.direct.toNumber()).toBeCloseTo(direct, 5);
      expect(result.raw.allIn.toNumber()).toBeCloseTo(allIn, 5);
    }
  });
  it("delí kladnú agentúrnu objednávku a dodatočnú reklamu odpočíta až od nášho podielu", () => {
    const result = calculate(order());
    expect(result.revenueNetCents).toBe(19300);
    expect(result.vatCents).toBe(4439);
    expect(result.revenueGrossCents).toBe(23739);
    expect(result.allInCostCents).toBe(11676);
    expect(result.divisibleProfitCents).toBe(7624);
    expect(result.rows[0].contributionCents).toBe(7624);
    expect(result.agencyShareCents).toBe(3812);
    expect(result.companyShareCents).toBe(3812);
    const advertised = calculate({ ...order(), assignedAdNet: "20" });
    expect(advertised.divisibleProfitCents).toBe(7624);
    expect(advertised.agencyShareCents).toBe(3812);
    expect(advertised.companyShareCents).toBe(3812);
    expect(advertised.effectiveCompanyCents).toBe(1812);
  });
  it("vlastnému zákazníkovi neskonštruuje províziu", () => {
    const result = calculate(order("OWN"));
    expect(result.agencyShareCents).toBe(0);
    expect(result.companyShareCents).toBe(7624);
  });
  it("100 balení po dvoch shotoch dosiahne 200-kusový stupeň a krabičku násobí baleniami", () => {
    const input = order("AGENCY", 200);
    input.packages = [{ name: "Krabička", kind: "TWO_60", quantity: 100, contents: [{ sku: "GINGER_60", quantityPerPackage: 2 }], unitMaterialCost: "0.50", unitBrandingCost: "0", unitLaborCost: "0", unitWasteCost: "0", unitRevenueNet: "1", costsConfirmed: true }];
    const r = calculate(input);
    expect(r.totalShots).toBe(200); expect(r.totalPackages).toBe(100); expect(r.threshold).toBe(200);
    expect(r.productRevenueCents).toBe(37600); expect(r.packageRevenueCents).toBe(10000); expect(r.packageCostCents).toBe(5000);
  });
  it("zisk na balenie neobsahuje samostatne predané shoty", () => {
    const input = order("AGENCY", 300);
    input.packages = [{ name: "Krabička", kind: "TWO_60", quantity: 100, contents: [{ sku: "GINGER_60", quantityPerPackage: 2 }], unitMaterialCost: "0.50", unitBrandingCost: "0", unitLaborCost: "0", unitWasteCost: "0", unitRevenueNet: "1", costsConfirmed: true }];
    const withStandalone = calculate(input);
    const onlyPackages = calculate({ ...input, items: [{ sku: "GINGER_60", quantity: 200, manualUnitNet: "1.83", priceReason: "Rovnaká cena na porovnanie" }] });
    expect(withStandalone.profitPerPackageCents).toBe(onlyPackages.profitPerPackageCents);
  });
  it("odpočíta vstupnú DPH z nákupnej ceny krabičky iba pri odpočítateľnom režime", () => {
    const input = order("AGENCY", 100);
    input.packages = [{ name: "Krabička", kind: "CUSTOM", quantity: 10, contents: [{ sku: "GINGER_60", quantityPerPackage: 1 }], unitMaterialCost: "1.19", materialVatRate: "19", materialVatDeductible: true, unitBrandingCost: "0", unitLaborCost: "0", unitWasteCost: "0", unitRevenueNet: "0", costsConfirmed: true }];
    expect(calculate(input).packageCostCents).toBe(1000);
    input.packages[0].materialVatDeductible = false;
    expect(calculate(input).packageCostCents).toBe(1190);
  });
  it("zmiešaný produktový mix používa samostatné náklady", () => {
    const input = order();
    input.items = [{ sku: "GINGER_60", quantity: 25 }, { sku: "GINGER_200", quantity: 25 }, { sku: "PINEAPPLE_60", quantity: 25 }, { sku: "PINEAPPLE_200", quantity: 25 }];
    const r = calculate(input);
    expect(new Set(r.rows.map(row => row.allInCostCents)).size).toBe(4);
    expect(r.rows.reduce((n, row) => n + row.quantity, 0)).toBe(100);
  });
  it("zmena nákupnej ceny vytvorí iný výsledok bez mutácie pôvodného snapshotu", () => {
    const first = calculate(order());
    const updated = structuredClone(APPROVED_CONFIG);
    updated.costs.ingredients.ginger.purchase = "4.00";
    const second = calculate(order(), updated);
    expect(second.divisibleProfitCents).toBeLessThan(first.divisibleProfitCents);
    expect(calculate(order()).divisibleProfitCents).toBe(first.divisibleProfitCents);
  });
  it("príjmy z dopravy a jej náklad sa započítajú práve raz", () => {
    const input = order();
    input.revenues = [{ name: "Doprava", category: "SHIPPING", quantity: "1", unitNet: "10", vatRate: "23" }];
    input.extraCosts = [{ name: "Kuriér", category: "SHIPPING", quantity: "1", unit: "služba", unitPurchasePrice: "5", vatRate: "0", vatDeductible: false, includeInProfit: true }];
    const r = calculate(input);
    expect(r.serviceRevenueCents).toBe(1000); expect(r.extraCostCents).toBe(500);
    expect(r.divisibleProfitCents).toBe(8124);
  });
  it("neznámy pôvod ponechá pozitívny zisk nealokovaný", () => {
    const r = calculate(order("UNKNOWN"));
    expect(r.agencyShareCents).toBe(0); expect(r.companyShareCents).toBe(0);
    expect(r.unallocatedProfitCents).toBe(7624);
  });
  it("nula a strata nikdy nevytvoria zápornú províziu", () => {
    const input = order(); input.items[0].manualUnitNet = "0"; input.items[0].priceReason = "Schválená skúšobná cena";
    const loss = calculate(input); expect(loss.loss).toBe(true); expect(loss.agencyShareCents).toBe(0);
    expect(loss.companyShareCents).toBe(loss.divisibleProfitCents);
    const zero = { ...order(), items: [{ sku: "GINGER_60" as const, quantity: 100, manualUnitNet: calculateUnitCost("GINGER_60").raw.allIn.toString(), priceReason: "Test nulovej marže" }] };
    const near = calculate(zero); expect(Math.abs(near.divisibleProfitCents)).toBeLessThanOrEqual(1);
  });
  it("vyžaduje ručnú cenu pod 100 kusov a dôvod individuálnej ceny", () => {
    expect(() => calculate(order("AGENCY", 99))).toThrow(/Pod 100/);
    const input = order("AGENCY", 99); input.items[0].manualUnitNet = "1.50";
    expect(() => calculate(input)).toThrow(/dôvod/);
    input.items[0].priceReason = "Schválená cena"; expect(calculate(input).threshold).toBeNull();
  });
  it("práh je minimálny počet a nad 1000 ostáva posledný stupeň", () => {
    for (const [qty, tier] of [[100,100],[199,100],[200,200],[300,300],[500,500],[800,800],[1000,1000],[1200,1000]]) expect(calculate(order("AGENCY", qty)).threshold).toBe(tier);
  });
  it("neznámy náklad blokuje finalizáciu a reklamná kategória je oddelená", () => {
    const input = order(); input.extraCosts = [{ name: "Potlač", category: "PRINT", quantity: "1", unit: "ks", unitPurchasePrice: null, vatRate: "0", vatDeductible: false, includeInProfit: true }];
    expect(calculate(input).missing).toContain("Potlač: jednotkový náklad");
    input.extraCosts[0].category = "CAMPAIGN_AD";
    expect(() => calculate(input)).toThrow(/Reklamu/);
  });
  it("centové delenie je deterministické", () => {
    const input = order(); input.revenues = [{ name: "Cent", category: "OTHER", quantity: "1", unitNet: "0.01", vatRate: "23" }];
    const r = calculate(input); expect(r.agencyShareCents + r.companyShareCents).toBe(r.divisibleProfitCents);
  });
  it("celková DPH sa rovná súčtu zaokrúhlených sadzieb", () => {
    const input = order();
    input.revenues = [
      { name: "Služba 23 %", category: "SERVICE", quantity: "1", unitNet: "0.02", vatRate: "23" },
      { name: "Služba 10 %", category: "SERVICE", quantity: "1", unitNet: "0.02", vatRate: "10" },
    ];
    const r = calculate(input);
    expect(r.vatCents).toBe(Object.values(r.vatByRateCents).reduce((sum, amount) => sum + amount, 0));
    expect(r.revenueGrossCents).toBe(r.revenueNetCents + r.vatCents);
  });
});
