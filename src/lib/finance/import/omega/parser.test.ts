import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { decodeOmegaExport } from "./decode";
import { parseOmegaText } from "./parser";

const partner = [
  "R01",
  "Odberateľ Test, s. r. o.",
  "12345678",
  "Testovacia 1",
  "81101",
  "Bratislava",
  "",
  "Slovenská republika",
  ...Array(16).fill(""),
  "SK",
  "2020000000",
  "",
  ...Array(5).fill(""),
].join("\t");

function invoiceHeader(kind: "OF" | "DF", total: string, supplierNumber = ""): string {
  const row = Array(98).fill("");
  row[0] = "R01";
  row[1] = "2026001";
  row[2] = "Odberateľ Test, s. r. o.";
  row[3] = "12345678";
  row[4] = "01.02.2026";
  row[5] = "15.02.2026";
  row[6] = "01.02.2026";
  row[18] = kind;
  row[19] = kind;
  row[24] = "Testovacia 1";
  row[25] = "81101";
  row[26] = "Bratislava";
  row[27] = "2020000000";
  row[39] = "EUR";
  row[42] = total;
  row[43] = supplierNumber;
  row[47] = "SK";
  row[68] = kind === "DF" ? "02.02.2026" : "";
  row[70] = kind === "OF" ? "2026001" : "900001";
  return row.join("\t");
}

function item(description: string, quantity: string, unit: string, price: string): string {
  const row = Array(55).fill("");
  row[0] = "R02";
  row[1] = description;
  row[2] = quantity;
  row[3] = unit;
  row[4] = price;
  return row.join("\t");
}

describe("Omega parser", () => {
  it("parses partners, both invoice directions and computes a deterministic preview", () => {
    const text = [
      "R00\tT04\t",
      partner,
      "R00\tT01\t",
      invoiceHeader("OF", "13"),
      item("Produkt", "2", "ks", "6.5"),
      invoiceHeader("DF", "7.37", "SUP-001"),
      item("Služba", "1", "", "7.37"),
    ].join("\r\n");

    const result = parseOmegaText(text);

    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({
      partnerCount: 1,
      invoiceCount: 2,
      issuedInvoiceCount: 1,
      receivedInvoiceCount: 1,
      itemCount: 2,
      issuedGrossCents: 1300,
      receivedGrossCents: 737,
      highestIssuedNumber: "2026001",
      nextIssuedNumber: "2026002",
      warningCount: 1,
    });
    expect(result.invoices[1]).toMatchObject({
      invoiceNumber: "PF2026001",
      externalNumber: "SUP-001",
      variableSymbol: "900001",
    });
    expect(result.invoices[1]?.items[0]?.unit).toBe("ks");
  });

  it("decodes an Omega text file from ZIP", () => {
    const bytes = zipSync({ "Omega/omega.txt": strToU8("R00\tT04\t\r\n") });
    expect(decodeOmegaExport(bytes)).toEqual({
      entryName: "Omega/omega.txt",
      text: "R00\tT04\t\r\n",
    });
  });

  it("reports mismatched header and item totals as a blocking error", () => {
    const result = parseOmegaText(
      ["R00\tT04\t", partner, "R00\tT01\t", invoiceHeader("OF", "10"), item("Produkt", "2", "ks", "6.5")].join(
        "\n",
      ),
    );
    expect(result.errors).toContain(
      "Faktúra 2026001: súčet položiek 1300 centov sa nerovná hlavičke 1000 centov.",
    );
  });
});
