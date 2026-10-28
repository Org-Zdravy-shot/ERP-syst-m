import { describe, expect, it } from "vitest";
import { formatUnitPrice, lineNetCents, parseUnitPrice, unitPriceCents } from "./precise-price";
import { computeTotals } from "./invoicing";
import { calculateInvoice } from "./finance/domain";

describe("presná jednotková cena", () => {
  it.each(["1,827", "1.827", "1,8270", "1.8270"])("prijme %s a účtuje Gleistein presne", (input) => {
    const exact = parseUnitPrice(input);
    expect(exact).toBe("1.8270");
    expect(unitPriceCents(exact)).toBe(183); // legacy snapshot; sumu neurčuje tento zaokrúhlený údaj
    expect(lineNetCents(150, exact)).toBe(27_405);
    expect(computeTotals([{ quantity: 150, unitPriceCents: 183, unitPriceExact: exact, vatRate: 23 }]))
      .toEqual({ totalNetCents: 27_405, totalVatCents: 6_303, totalGrossCents: 33_708 });
    const invoice = calculateInvoice({ currency: "EUR", lines: [{ description: "Shot 60 ml", quantity: 150, unit: "ks", unitPriceCents: 183, unitPriceExact: exact, vatRate: 23 }] });
    expect(invoice.totalGrossCents).toBe(33_708);
    expect(invoice.lines[0].unitPriceExact).toBe("1.8270");
  });

  it("pripočíta dopravu 20 € k základu Gleistein bez zaokrúhlenia ceny za kus", () => {
    const total = computeTotals([
      { quantity: 150, unitPriceCents: 183, unitPriceExact: "1.8270", vatRate: 23 },
      { quantity: 1, unitPriceCents: 2000, vatRate: 0 },
    ]);
    expect(total.totalNetCents).toBe(29_405);
    expect(total.totalVatCents).toBe(6_303); // DPH dopravy zostáva na overenie.
  });

  it.each([["1,80", "1.8000"], ["1.82", "1.8200"], ["1.8250", "1.8250"], ["1.8275", "1.8275"]])("zachová cenu %s", (input, expected) => {
    expect(parseUnitPrice(input)).toBe(expected);
    expect(formatUnitPrice(expected)).toBe(input.replace(".", ",").replace(/0+$/, "").replace(/,$/, ""));
  });
  it("zaokrúhli základ až po násobení polovicou nahor", () => {
    expect(lineNetCents(150, "1.8275")).toBe(27_413);
  });
  it("zachová presnosť aj pri desatinnom množstve na ručnej faktúre", () => {
    expect(lineNetCents(1.5, "1.8270")).toBe(274);
    const invoice = calculateInvoice({ currency: "EUR", lines: [{ description: "Služba", quantity: 1.5, unit: "h", unitPriceCents: 183, unitPriceExact: "1.8270", vatRate: 23 }] });
    expect(invoice.lines[0].totalNetCents).toBe(274);
    expect(invoice.lines[0].unitPriceExact).toBe("1.8270");
  });
  it.each(["", "-1", "1,23456", "1.2.3", "abc"])("odmietne neplatnú cenu %s", (input) => {
    expect(() => parseUnitPrice(input)).toThrow();
  });
});
