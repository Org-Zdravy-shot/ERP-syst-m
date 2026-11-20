import { describe, expect, it, vi } from "vitest";
import { lookupAutoform, mapAutoformResults } from "./company-lookup";

describe("company lookup", () => {
  it("maps official fields, keeps leading zeroes and does not infer VAT IDs", () => {
    const [row] = mapAutoformResults([{ id: 1, name: "Firma", cin: "00123456", tin: null, vatin: null, street: "Hlavná", reg_number: 12, building_number: "3", municipality: "Žilina", postal_code: "010 01", country: "Slovenská republika" }]);
    expect(row).toMatchObject({ ico: "00123456", dic: "", icDph: "", street: "Hlavná 12/3", city: "Žilina", country: "SK" });
  });
  it("excludes terminated companies and rejects malformed responses", () => {
    expect(mapAutoformResults([{ id: 1, name: "Zaniknutá", cin: "12345678", terminated_on: "2025-01-01" }])).toEqual([]);
    expect(() => mapAutoformResults({ results: [] })).toThrow();
    expect(() => mapAutoformResults([{ id: 1, name: "Firma", cin: null }])).toThrow("IČO");
    expect(() => mapAutoformResults([{ id: 1, name: "Firma", cin: "00000000" }])).toThrow("IČO");
  });
  it("uses the documented query and never sends partial ICO requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("[]"));
    await lookupAutoform("00123456", { apiKey: "test-secret", fetcher });
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.searchParams.get("q")).toBe("cin:00123456");
    expect(url.searchParams.get("filter")).toBe("active");
    await lookupAutoform("0012", { apiKey: "test-secret", fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not leak provider errors or credentials", async () => {
    await expect(lookupAutoform("Firma", { apiKey: "secret", fetcher: vi.fn().mockRejectedValue(new Error("url?private_access_token=secret")) })).rejects.toThrow("dočasne nedostupný");
  });
});
