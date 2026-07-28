import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseVrp2Xlsx } from "./vrp2-xlsx";

const sharedStrings = [
  "Report",
  "Unikátny identifikátor dokladu",
  "Dátum zaevidovania",
  "EAN",
  "Kód tovaru",
  "Označenie tovaru/služby",
  "Typ položky",
  "Množstvo",
  "Suma položky",
  "V-ABC",
  "8582000065507",
  "ZS-KLA-200",
  "Zdravý shot - zázvor",
  "kladná",
];

function workbookFixture() {
  const stringsXml = `<sst>${sharedStrings.map((value) => `<si><t>${value}</t></si>`).join("")}</sst>`;
  const sheetXml = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c></row>
    <row r="2">
      <c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c>
      <c r="C2" t="s"><v>3</v></c><c r="D2" t="s"><v>4</v></c>
      <c r="E2" t="s"><v>5</v></c><c r="F2" t="s"><v>6</v></c>
      <c r="G2" t="s"><v>7</v></c><c r="H2" t="s"><v>8</v></c>
    </row>
    <row r="3">
      <c r="A3" t="s"><v>9</v></c><c r="B3"><v>46174.615231481483</v></c>
      <c r="C3" t="s"><v>10</v></c><c r="D3" t="s"><v>11</v></c>
      <c r="E3" t="s"><v>12</v></c><c r="F3" t="s"><v>13</v></c>
      <c r="G3"><v>2</v></c><c r="H3"><v>10.5</v></c>
    </row>
  </sheetData></worksheet>`;
  return zipSync({
    "xl/sharedStrings.xml": strToU8(stringsXml),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml),
  });
}

describe("parseVrp2Xlsx", () => {
  it("reads the official extended-report columns and Slovak local timestamp", () => {
    const result = parseVrp2Xlsx(workbookFixture());

    expect(result.receiptCount).toBe(1);
    expect(result.ignoredRows).toBe(0);
    expect(result.rows).toEqual([
      {
        saleDate: "2026-06-01T12:45:56.000Z",
        receiptNumber: "V-ABC",
        description: "Zdravý shot - zázvor",
        productCode: "ZS-KLA-200",
        ean: "8582000065507",
        itemType: "kladná",
        quantity: 2,
        totalGrossCents: 1050,
        vatRate: null,
        source: "VRP2_XLSX",
      },
    ]);
  });

  it("rejects an unrelated workbook", () => {
    const unrelated = zipSync({
      "xl/worksheets/sheet1.xml": strToU8(
        "<worksheet><sheetData><row><c r=\"A1\"><v>1</v></c></row></sheetData></worksheet>",
      ),
    });
    expect(() => parseVrp2Xlsx(unrelated)).toThrow("rozšírený report VRP2");
  });
});
