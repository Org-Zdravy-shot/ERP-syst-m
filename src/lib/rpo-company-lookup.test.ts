import { describe, expect, it, vi } from "vitest";
import { lookupRpo, mapRpoResults } from "./rpo-company-lookup";

const row = {
  id: 1,
  identifiers: [{ value: "00123456", validFrom: "2010-01-01" }],
  fullNames: [
    { value: "Starý názov", validFrom: "2010-01-01", validTo: "2024-12-31" },
    { value: "Čerstvá firma", validFrom: "2025-01-01" },
  ],
  addresses: [
    { street: "Nová", buildingNumber: "4", regNumber: 7, validFrom: "2025-01-01",
      municipality: { value: "Žilina" }, country: { code: "703" }, postalCodes: ["01001"] },
    { street: "Stará", validTo: "2024-12-31" },
    { street: "Budúca", validFrom: "2027-01-01" },
  ],
};

describe("verejný register RPO", () => {
  it("vyberie aktuálny názov a adresu, zachová vedúce nuly a nedoplní daňové identifikátory", () => {
    expect(mapRpoResults({ results: [row] }, "cerstva", "2026-11-22")).toEqual([
      expect.objectContaining({
        source: "RPO", name: "Čerstvá firma", ico: "00123456", street: "Nová 7/4",
        city: "Žilina", zip: "01001", country: "SK", dic: "", icDph: "",
      }),
    ]);
  });

  it("vynechá neplatné, zaniknuté a cudzie záznamy a zjednotí rovnaké IČO", () => {
    const rows = [
      { ...row, id: 2, termination: "2026-01-01" },
      { ...row, id: 3, identifiers: [{ value: "00123457" }], addresses: [{ country: { code: "203" } }] },
      { ...row, id: 4, identifiers: [{ value: "123" }] },
      row,
      { ...row, id: 5 },
    ];
    expect(mapRpoResults({ results: rows }, "Čerstvá", "2026-11-22").map((match) => match.id)).toEqual(["rpo:1"]);
    expect(mapRpoResults({ results: [row] }, "Starý názov", "2026-11-22")).toEqual([]);
  });

  it("odosiela celé IČO a krátky neúplný vstup nechá bez volania", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [row] }));
    await expect(lookupRpo("0012", fetcher)).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(lookupRpo("00 123 456", fetcher)).resolves.toMatchObject([{ ico: "00123456" }]);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("identifier")).toBe("00123456");
    expect(url.searchParams.get("onlyActive")).toBe("true");
  });

  it("po HTTP 429 ďalšiu požiadavku na register okamžite neopakuje", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": "45" } }));
    await expect(lookupRpo("00123456", fetcher)).rejects.toThrow("obmedzený počet");
    await expect(lookupRpo("Čerstvá firma", fetcher)).rejects.toThrow("obmedzený počet");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
