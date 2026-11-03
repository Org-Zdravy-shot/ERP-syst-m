import { z } from "zod";
import { christmasOriginSchema, christmasOrderStatusSchema } from "@/lib/zod-schemas";

const money = z.string().regex(/^\d{1,10}(?:[.,]\d{1,4})?$/, "Zadajte platnú nezápornú sumu (najviac 4 desatinné miesta).").transform(s => s.replace(",", "."));
const nullableMoney = money.nullish();
const sku = z.enum(["GINGER_60", "GINGER_200", "PINEAPPLE_60", "PINEAPPLE_200"]);
const vat = z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/);
export const isoDate = z.string().refine(value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Neplatný kalendárny dátum.");
export const calculationInputSchema = z.object({
  origin: christmasOriginSchema,
  items: z.array(z.object({ sku, quantity: z.number().int().positive().max(1000000), manualUnitNet: money.optional(), priceReason: z.string().trim().max(500).optional(), vatRate: vat.optional() })).max(100),
  packages: z.array(z.object({ name: z.string().trim().min(1).max(150), kind: z.string().trim().min(1).max(50), quantity: z.number().int().positive().max(1000000), contents: z.array(z.object({ sku, quantityPerPackage: z.number().int().positive() })).max(20), brandingDescription: z.string().max(1000).optional(), unitMaterialCost: nullableMoney, materialVatRate: vat.optional(), materialVatDeductible: z.boolean().optional(), unitBrandingCost: nullableMoney, unitLaborCost: nullableMoney, unitWasteCost: nullableMoney, unitRevenueNet: nullableMoney, vatRate: vat.optional(), costsConfirmed: z.boolean() })).max(100),
  extraCosts: z.array(z.object({ name: z.string().trim().min(1).max(150), category: z.string().trim().min(1).max(50), quantity: money, unit: z.string().trim().min(1).max(20), unitPurchasePrice: nullableMoney, vatRate: vat, vatDeductible: z.boolean(), includeInProfit: z.boolean(), confirmedNoCost: z.boolean().optional(), note: z.string().max(1000).optional() })).max(100),
  revenues: z.array(z.object({ name: z.string().trim().min(1).max(150), category: z.string().trim().min(1).max(50), quantity: money, unitNet: money, vatRate: vat })).max(100),
});
export const saveSchema = z.object({ campaignId: z.string().min(1), orderId: z.string().optional(), expectedRevision: z.number().int().nonnegative().optional(), submissionKey: z.string().uuid(), clientId: z.string().min(1), contactName: z.string().max(150).optional(), deliveryDate: z.union([isoDate, z.literal("")]).optional(), note: z.string().max(3000).optional(), leadId: z.string().max(150).optional(), source: z.string().max(150).optional(), sourceCampaign: z.string().max(150).optional(), crmReference: z.string().max(300).optional(), attributionNote: z.string().max(1000).optional(), input: calculationInputSchema });
export const statusSchema = christmasOrderStatusSchema;
