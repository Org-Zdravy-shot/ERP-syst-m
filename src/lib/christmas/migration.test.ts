import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261102180000_christmas_campaign/migration.sql"), "utf8");
describe("Izolácia schémy vianočnej kampane", () => {
  it("vytvára samostatné tabuľky a databázové väzby na kampaň", () => {
    for (const name of ["christmas_campaign", "christmas_order", "christmas_order_item", "christmas_calculation_snapshot", "christmas_ad_expense", "christmas_settlement", "christmas_audit_log"]) expect(sql).toContain(`CREATE TABLE "${name}"`);
    expect(sql).toContain('FOREIGN KEY ("orderId", "campaignId") REFERENCES "christmas_order"("id", "campaignId")');
    expect(sql).toContain('FOREIGN KEY ("campaignId", "legalEntity") REFERENCES "christmas_campaign"("id", "legalEntity")');
    expect(sql).toContain('FOREIGN KEY ("pricingVersionId", "campaignId") REFERENCES "christmas_pricing_version"("id", "campaignId")');
  });
});
