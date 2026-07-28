import { unzipSync } from "fflate";
import { bratislavaDateTimeToIso } from "@/lib/datetime";
import { normalizeHeader, parseAmountToCents } from "@/app/(app)/financie/import/csv";

export interface Vrp2PreviewRow {
  saleDate: string;
  receiptNumber: string;
  description: string;
  productCode?: string;
  ean?: string;
  itemType?: string;
  quantity: number;
  totalGrossCents: number;
  vatRate: number | null;
  source: "VRP2_XLSX";
}

export interface Vrp2ParseResult {
  rows: Vrp2PreviewRow[];
  receiptCount: number;
  ignoredRows: number;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&");
}

function textNodes(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXmlEntities(match[1] ?? ""))
    .join("");
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) =>
    textNodes(match[1] ?? ""),
  );
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? "";
  return (
    letters.split("").reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1
  );
}

function parseWorksheet(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    const body = rowMatch[1] ?? "";
    for (const cellMatch of body.matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1] ?? "";
      const cellBody = cellMatch[2] ?? "";
      const reference = attributes.match(/\br="([^"]+)"/)?.[1];
      if (!reference) continue;

      const raw = cellBody.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      let value = raw;
      if (/\bt="s"/.test(attributes)) value = sharedStrings[Number(raw)] ?? "";
      else if (/\bt="inlineStr"/.test(attributes)) value = textNodes(cellBody);
      else value = decodeXmlEntities(raw);
      row[columnIndex(reference)] = value.trim();
    }
    rows.push(row);
  }
  return rows;
}

function excelSerialToIso(value: string): string | null {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial <= 0) return null;

  const milliseconds = Math.round(serial * 86_400_000);
  const excelClock = new Date(Date.UTC(1899, 11, 30) + milliseconds);
  return bratislavaDateTimeToIso(
    excelClock.getUTCFullYear(),
    excelClock.getUTCMonth() + 1,
    excelClock.getUTCDate(),
    excelClock.getUTCHours(),
    excelClock.getUTCMinutes(),
    excelClock.getUTCSeconds(),
  );
}

function headerIndex(headers: string[], exactName: string): number {
  const wanted = normalizeHeader(exactName);
  return headers.findIndex((header) => normalizeHeader(header) === wanted);
}

export function parseVrp2Xlsx(data: Uint8Array): Vrp2ParseResult {
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(data);
  } catch {
    throw new Error("Súbor nie je platný Excel XLSX.");
  }

  const decoder = new TextDecoder("utf-8");
  const sharedStrings = parseSharedStrings(
    archive["xl/sharedStrings.xml"]
      ? decoder.decode(archive["xl/sharedStrings.xml"])
      : undefined,
  );
  const worksheets = Object.entries(archive)
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, bytes]) => parseWorksheet(decoder.decode(bytes), sharedStrings));

  let sheet: string[][] | undefined;
  let headerRowIndex = -1;
  for (const candidate of worksheets) {
    const index = candidate.findIndex(
      (row) =>
        headerIndex(row, "Unikátny identifikátor dokladu") >= 0 &&
        headerIndex(row, "Dátum zaevidovania") >= 0 &&
        headerIndex(row, "Suma položky") >= 0,
    );
    if (index >= 0) {
      sheet = candidate;
      headerRowIndex = index;
      break;
    }
  }
  if (!sheet || headerRowIndex < 0) {
    throw new Error(
      "V Exceli sa nenašiel rozšírený report VRP2. Vytvorte vo VRP2 typ „Rozšírený report“.",
    );
  }

  const headers = sheet[headerRowIndex] ?? [];
  const columns = {
    receipt: headerIndex(headers, "Unikátny identifikátor dokladu"),
    date: headerIndex(headers, "Dátum zaevidovania"),
    ean: headerIndex(headers, "EAN"),
    productCode: headerIndex(headers, "Kód tovaru"),
    description: headerIndex(headers, "Označenie tovaru/služby"),
    itemType: headerIndex(headers, "Typ položky"),
    quantity: headerIndex(headers, "Množstvo"),
    gross: headerIndex(headers, "Suma položky"),
  };

  const rows: Vrp2PreviewRow[] = [];
  let ignoredRows = 0;
  for (const sourceRow of sheet.slice(headerRowIndex + 1)) {
    const receiptNumber = sourceRow[columns.receipt]?.trim() ?? "";
    const saleDate = excelSerialToIso(sourceRow[columns.date] ?? "");
    const description = sourceRow[columns.description]?.trim() ?? "";
    const quantity = Number((sourceRow[columns.quantity] ?? "").replace(",", "."));
    const totalGrossCents = parseAmountToCents(sourceRow[columns.gross] ?? "");

    if (
      !receiptNumber ||
      !saleDate ||
      !description ||
      !Number.isFinite(quantity) ||
      quantity === 0 ||
      totalGrossCents === null
    ) {
      ignoredRows += 1;
      continue;
    }

    rows.push({
      saleDate,
      receiptNumber,
      description,
      productCode: sourceRow[columns.productCode]?.trim() || undefined,
      ean: sourceRow[columns.ean]?.trim() || undefined,
      itemType: sourceRow[columns.itemType]?.trim() || undefined,
      quantity,
      totalGrossCents,
      vatRate: null,
      source: "VRP2_XLSX",
    });
  }

  if (rows.length === 0) {
    throw new Error("V rozšírenom reporte VRP2 sa nenašli žiadne platné položky predaja.");
  }

  return {
    rows,
    receiptCount: new Set(rows.map((row) => row.receiptNumber)).size,
    ignoredRows,
  };
}
