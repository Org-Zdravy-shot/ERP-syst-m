import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { APPROVED_CONFIG, calculate } from "./engine";

const url = process.env.CHRISTMAS_TEST_DATABASE_URL;
const parsed = url ? new URL(url) : null;
const dbName = parsed?.pathname.slice(1) ?? "";
const enabled = Boolean(parsed && (
  /^christmas_test_[a-z0-9_]+$/i.test(dbName) ||
  (parsed.hostname === "127.0.0.1" && ["55433", "55434"].includes(parsed.port) && dbName === "postgres")
));
const isolated = describe.runIf(enabled);
const db = enabled ? new PrismaClient({ datasources: { db: { url } } }) : null;
const initial = { prices: APPROVED_CONFIG.prices, costs: APPROVED_CONFIG.costs, recipes: APPROVED_CONFIG.recipes };

isolated("Vianočná perzistencia v izolovanom PostgreSQL", () => {
  it("ukladá nemenné revízie, izoluje kampane a nezasahuje do všeobecných objednávok", async () => {
    await expect(db!.$transaction(async tx => {
      const client = await tx.client.create({ data: { type: "B2B", name: "Integračný test" } });
      const a = await tx.christmasCampaign.create({ data: { legalEntity: "KURGI", year: 2098, name: `Test ${crypto.randomUUID()}` } });
      const b = await tx.christmasCampaign.create({ data: { legalEntity: "KURGI", year: 2099, name: `Test ${crypto.randomUUID()}` } });
      const [price, cost, recipe] = await Promise.all([
        tx.christmasPricingVersion.create({ data: { campaignId: a.id, version: 1, data: initial.prices, reason: "Test" } }),
        tx.christmasCostVersion.create({ data: { campaignId: a.id, version: 1, data: initial.costs, reason: "Test" } }),
        tx.christmasRecipeVersion.create({ data: { campaignId: a.id, version: 1, data: initial.recipes, reason: "Test" } }),
      ]);
      const genericBefore = await tx.order.count();
      const order = await tx.christmasOrder.create({ data: { campaignId: a.id, legalEntity: "KURGI", number: "TEST-1", clientId: client.id, submissionKey: crypto.randomUUID() } });
      const input = { origin: "AGENCY" as const, items: [{ sku: "GINGER_60" as const, quantity: 100 }], packages: [], extraCosts: [], revenues: [] };
      const result = calculate(input);
      await tx.christmasCalculationSnapshot.create({ data: { orderId: order.id, campaignId: a.id, revision: 1, pricingVersionId: price.id, costVersionId: cost.id, recipeVersionId: recipe.id, input, configuration: APPROVED_CONFIG, result, revenueNetCents: result.revenueNetCents, revenueGrossCents: result.revenueGrossCents, directCostCents: result.directCostCents, overheadCents: result.overheadCents, otherCostCents: result.otherCostCents, divisibleProfitCents: result.divisibleProfitCents, agencyShareCents: result.agencyShareCents, companyShareCents: result.companyShareCents } });
      expect(await tx.order.count()).toBe(genericBefore);
      await tx.christmasCostVersion.create({ data: { campaignId: a.id, version: 2, data: { ...APPROVED_CONFIG.costs, bottle60: "0.999" }, reason: "Test zmeny" } });
      const old = await tx.christmasCalculationSnapshot.findUniqueOrThrow({ where: { orderId_revision: { orderId: order.id, revision: 1 } } });
      expect(old.divisibleProfitCents).toBe(7624);
      expect(await tx.christmasOrder.count({ where: { campaignId: b.id } })).toBe(0);
      await expect(tx.christmasOrderItem.create({ data: { orderId: order.id, campaignId: b.id, revision: 1, sku: "GINGER_60", quantity: 100, vatRate: 23 } })).rejects.toThrow();
      throw new Error("ROLLBACK_SENTINEL");
    })).rejects.toThrow("ROLLBACK_SENTINEL");
  });
  it("unikátny kľúč odmieta duplicitné vytvorenie", async () => {
    await expect(db!.$transaction(async tx => {
      const client = await tx.client.create({ data: { type: "B2B", name: "Duplicitný test" } });
      const campaign = await tx.christmasCampaign.create({ data: { legalEntity: "KURGI", year: 2097, name: `Test ${crypto.randomUUID()}` } });
      const submissionKey = crypto.randomUUID();
      await tx.christmasOrder.create({ data: { campaignId: campaign.id, legalEntity: "KURGI", clientId: client.id, number: "TEST-1", submissionKey } });
      await expect(tx.christmasOrder.create({ data: { campaignId: campaign.id, legalEntity: "KURGI", clientId: client.id, number: "TEST-2", submissionKey } })).rejects.toThrow();
      throw new Error("ROLLBACK_SENTINEL");
    })).rejects.toThrow("ROLLBACK_SENTINEL");
  });
});
