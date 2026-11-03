import { Prisma } from "@prisma/client";
import { APPROVED_CONFIG, calculateUnitCost, type CampaignConfiguration } from "./engine";

function amount(value: unknown, label: string, positive = false) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error(`${label}: zadajte nezáporné desatinné číslo.`);
  const n = new Prisma.Decimal(value);
  if (!n.isFinite() || (positive && !n.greaterThan(0))) throw new Error(`${label}: hodnota musí byť kladná.`);
  return n;
}
export function validateConfig(config: CampaignConfiguration) {
  if (!config?.prices || !config.costs || !config.recipes) throw new Error("Neúplná konfigurácia kampane.");
  if (config.prices.thresholdMode !== "TOTAL_SHOTS") throw new Error("Podporovaný je iba prah podľa celkového počtu shotov.");
  if (config.splitRate !== "50") throw new Error("Dohodnutý podiel agentúry musí zostať 50 %.");
  amount(config.outputVatRate, "Výstupná DPH");
  if (new Prisma.Decimal(config.outputVatRate).greaterThan(100)) throw new Error("Výstupná DPH nesmie byť nad 100 %.");
  amount(config.prices.retailGross60, "Maloobchodná cena 60 ml", true);
  amount(config.prices.retailGross200, "Maloobchodná cena 200 ml", true);
  if (config.prices.thresholds.length !== 6 || config.prices.thresholds.map(t => t.min).join(",") !== "100,200,300,500,800,1000") throw new Error("Cenník musí zachovať schválené množstevné prahy.");
  for (const t of config.prices.thresholds) {
    amount(t.discount, `Zľava od ${t.min} ks`); amount(t.net60, `Cena 60 ml od ${t.min} ks`, true); amount(t.net200, `Cena 200 ml od ${t.min} ks`, true);
    if (new Prisma.Decimal(t.net60).decimalPlaces() > 2 || new Prisma.Decimal(t.net200).decimalPlaces() > 2) throw new Error(`Cenník od ${t.min} ks musí mať najviac dve desatinné miesta.`);
  }
  const c = config.costs;
  for (const [name, ingredient] of Object.entries(c.ingredients)) {
    amount(ingredient.purchase, `Nákupná cena ${name}`); amount(ingredient.vatRate, `Vstupná DPH ${name}`);
    if (ingredient.yieldMl) amount(ingredient.yieldMl, `Výťažnosť ${name}`, true);
    if (ingredient.densityKgPerL) amount(ingredient.densityKgPerL, `Hustota ${name}`, true);
    if (typeof ingredient.deductible !== "boolean") throw new Error(`${name}: zadajte režim odpočítania DPH.`);
  }
  for (const key of ["bottle60", "bottle200", "cap", "label60", "label200", "pasteurizationKwh", "electricityPerKwh"] as const) amount(c[key], key);
  for (const key of ["ingredientYieldFactor", "pasteurizationLiters", "benchmarkLiters"] as const) amount(c[key], key, true);
  if (new Prisma.Decimal(c.ingredientYieldFactor).greaterThan(1)) throw new Error("Výťažnosť surovín nemôže presiahnuť 100 %.");
  for (const key of Object.keys(APPROVED_CONFIG.costs.monthlyOverhead)) if (c.monthlyOverhead[key] === undefined) throw new Error(`V réžii chýba ${key}.`);
  for (const [name, value] of Object.entries(c.monthlyOverhead)) amount(value, `Réžia ${name}`);
  for (const [name, recipe] of Object.entries(config.recipes)) for (const [part, value] of Object.entries(recipe)) amount(value, `Receptúra ${name}: ${part}`);
  for (const sku of ["GINGER_60", "GINGER_200", "PINEAPPLE_60", "PINEAPPLE_200"] as const) calculateUnitCost(sku, config);
  return config;
}
export const initialVersionData = {
  pricing: APPROVED_CONFIG.prices as unknown as Prisma.InputJsonValue,
  costs: APPROVED_CONFIG.costs as unknown as Prisma.InputJsonValue,
  recipes: APPROVED_CONFIG.recipes as unknown as Prisma.InputJsonValue,
};
