import { calculateInvoice } from "../../domain";
import type {
  OmegaImportWarning,
  OmegaInvoice,
  OmegaInvoiceDirection,
  OmegaInvoiceItem,
  OmegaPartner,
  ParsedOmegaExport,
} from "./types";

const PARTNER_SECTION = "T04";
const INVOICE_SECTION = "T01";

function value(row: string[], index: number): string {
  return (row[index] ?? "").trim();
}

function optional(row: string[], index: number): string | undefined {
  return value(row, index) || undefined;
}

function normalizeZip(input: string | undefined): string | undefined {
  const normalized = input?.replace(/\s+/g, "");
  return normalized || undefined;
}

function parseDate(raw: string, label: string, rowNumber: number): Date {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
  if (!match) throw new Error(`Riadok ${rowNumber}: ${label} má neplatný dátum "${raw}".`);
  const [, day, month, year] = match;
  const result = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    result.getUTCFullYear() !== Number(year) ||
    result.getUTCMonth() !== Number(month) - 1 ||
    result.getUTCDate() !== Number(day)
  ) {
    throw new Error(`Riadok ${rowNumber}: ${label} má neplatný dátum "${raw}".`);
  }
  return result;
}

function parseOptionalDate(raw: string | undefined, label: string, rowNumber: number): Date | undefined {
  return raw ? parseDate(raw, label, rowNumber) : undefined;
}

function parseDecimal(raw: string, label: string, rowNumber: number): number {
  const normalized = raw.replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error(`Riadok ${rowNumber}: ${label} má neplatné číslo "${raw}".`);
  }
  const result = Number(normalized);
  if (!Number.isFinite(result)) throw new Error(`Riadok ${rowNumber}: ${label} nie je konečné číslo.`);
  return result;
}

function parseMoney(raw: string, label: string, rowNumber: number): number {
  const cents = Math.round(parseDecimal(raw, label, rowNumber) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error(`Riadok ${rowNumber}: ${label} presahuje bezpečný rozsah.`);
  return cents;
}

function mapPartnerRow(row: string[]): OmegaPartner {
  const rawIcDph = optional(row, 26);
  return {
    name: value(row, 1),
    ...(optional(row, 2) ? { ico: optional(row, 2) } : {}),
    ...(optional(row, 25) ? { dic: optional(row, 25) } : {}),
    ...(rawIcDph?.toUpperCase().startsWith("SK") ? { icDph: rawIcDph } : {}),
    ...(optional(row, 18) ? { phone: optional(row, 18) } : {}),
    ...(optional(row, 3) ? { street: optional(row, 3) } : {}),
    ...(optional(row, 5) ? { city: optional(row, 5) } : {}),
    ...(normalizeZip(optional(row, 4)) ? { zip: normalizeZip(optional(row, 4)) } : {}),
    country: optional(row, 24) || "SK",
    rawRow: row,
  };
}

function partnerFromInvoiceRow(row: string[]): OmegaPartner {
  return {
    name: value(row, 2),
    ...(optional(row, 3) ? { ico: optional(row, 3) } : {}),
    ...(optional(row, 27) ? { dic: optional(row, 27) } : {}),
    ...(optional(row, 58) ? { icDph: optional(row, 58) } : {}),
    ...(optional(row, 24) ? { street: optional(row, 24) } : {}),
    ...(optional(row, 26) ? { city: optional(row, 26) } : {}),
    ...(normalizeZip(optional(row, 25)) ? { zip: normalizeZip(optional(row, 25)) } : {}),
    country: optional(row, 47) || "SK",
    rawRow: row,
  };
}

function resolvePartner(
  invoiceRow: string[],
  partners: OmegaPartner[],
  warnings: OmegaImportWarning[],
  rowNumber: number,
): OmegaPartner {
  const invoicePartner = partnerFromInvoiceRow(invoiceRow);
  const byIco = invoicePartner.ico
    ? partners.find((partner) => partner.ico === invoicePartner.ico)
    : undefined;
  const byName = partners.find(
    (partner) => partner.name.localeCompare(invoicePartner.name, "sk", { sensitivity: "base" }) === 0,
  );
  const master = byIco ?? byName;
  if (!master) {
    warnings.push({
      code: "PARTNER_NOT_IN_MASTER",
      message: `Partner "${invoicePartner.name}" sa nenachádza v sekcii partnerov; použili sa údaje z faktúry.`,
      row: rowNumber,
      rawValue: invoicePartner.ico,
    });
    return invoicePartner;
  }
  if (invoicePartner.ico && master.ico && invoicePartner.ico !== master.ico) {
    warnings.push({
      code: "PARTNER_ICO_NORMALIZED",
      message: `IČO partnera "${master.name}" bolo normalizované podľa kmeňovej karty.`,
      row: rowNumber,
      rawValue: invoicePartner.ico,
    });
  }
  return master;
}

function mapDirection(row: string[], rowNumber: number): OmegaInvoiceDirection {
  const code = value(row, 19) || value(row, 18);
  if (code === "OF") return "VYDANA";
  if (code === "DF") return "PRIJATA";
  throw new Error(`Riadok ${rowNumber}: neznámy typ faktúry "${code}".`);
}

function mapInvoiceHeader(
  row: string[],
  partners: OmegaPartner[],
  warnings: OmegaImportWarning[],
  rowNumber: number,
): OmegaInvoice {
  const direction = mapDirection(row, rowNumber);
  const omegaNumber = value(row, 1);
  const partner = resolvePartner(row, partners, warnings, rowNumber);
  const supplierNumber = optional(row, 43);
  const invoiceNumber = direction === "VYDANA" ? omegaNumber : `PF${omegaNumber}`;
  const totalGrossCents = parseMoney(value(row, 42), "celková suma", rowNumber);
  const paidAt = parseOptionalDate(optional(row, 68), "dátum úhrady", rowNumber);

  return {
    direction,
    omegaNumber,
    externalId: `${direction}:${omegaNumber}:${supplierNumber ?? ""}`,
    externalNumber: direction === "PRIJATA" ? supplierNumber || omegaNumber : omegaNumber,
    invoiceNumber,
    partner,
    ...(optional(row, 3) ? { rawPartnerIco: optional(row, 3) } : {}),
    issueDate: parseDate(value(row, 4), "dátum vystavenia", rowNumber),
    dueDate: parseDate(value(row, 5), "dátum splatnosti", rowNumber),
    deliveryDate: parseDate(value(row, 6), "dátum dodania", rowNumber),
    ...(paidAt ? { paidAt } : {}),
    currency: "EUR",
    ...(optional(row, 70) ? { variableSymbol: optional(row, 70) } : {}),
    ...(optional(row, 45) || optional(row, 44)
      ? { note: optional(row, 45) || optional(row, 44) }
      : {}),
    totalNetCents: totalGrossCents,
    totalVatCents: 0,
    totalGrossCents,
    items: [],
    rawRow: row,
  };
}

function mapItem(
  row: string[],
  warnings: OmegaImportWarning[],
  rowNumber: number,
  invoiceNumber: string,
): OmegaInvoiceItem {
  const description = value(row, 1);
  const quantity = parseDecimal(value(row, 2), "množstvo", rowNumber);
  const unitPriceCents = parseMoney(value(row, 4), "jednotková cena", rowNumber);
  let unit = value(row, 3);
  if (!unit || /^-?\d+(?:[.,]\d+)?$/.test(unit)) {
    warnings.push({
      code: "ITEM_UNIT_NORMALIZED",
      message: `Chýbajúca alebo neplatná jednotka položky bola nastavená na "ks".`,
      row: rowNumber,
      invoiceNumber,
      rawValue: unit,
    });
    unit = "ks";
  }
  const calculation = calculateInvoice({
    currency: "EUR",
    lines: [{ description, quantity, unit, unitPriceCents, vatRate: 0, taxCategory: "EXEMPT" }],
  }).lines[0];
  if (!calculation) throw new Error(`Riadok ${rowNumber}: položku sa nepodarilo vypočítať.`);

  return {
    description,
    quantity,
    unit,
    unitPriceCents,
    vatRate: 0,
    totalNetCents: calculation.totalNetCents,
    totalVatCents: calculation.totalVatCents,
    totalGrossCents: calculation.totalGrossCents,
    rawRow: row,
  };
}

function nextIssuedNumber(highest: string | null): string | null {
  if (!highest || !/^\d{7}$/.test(highest)) return null;
  const year = highest.slice(0, 4);
  const sequence = Number(highest.slice(4));
  return `${year}${String(sequence + 1).padStart(3, "0")}`;
}

export function parseOmegaText(text: string): ParsedOmegaExport {
  const partners: OmegaPartner[] = [];
  const invoices: OmegaInvoice[] = [];
  const warnings: OmegaImportWarning[] = [];
  const errors: string[] = [];
  let section: string | undefined;
  let currentInvoice: OmegaInvoice | undefined;

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (!rawLine?.trim()) continue;
    const rowNumber = index + 1;
    const row = rawLine.split("\t");
    const marker = value(row, 0);
    try {
      if (marker === "R00") {
        section = value(row, 1);
        currentInvoice = undefined;
        continue;
      }
      if (marker === "R01" && section === PARTNER_SECTION) {
        const partner = mapPartnerRow(row);
        if (!partner.name) throw new Error(`Riadok ${rowNumber}: partner nemá názov.`);
        partners.push(partner);
        continue;
      }
      if (marker === "R01" && section === INVOICE_SECTION) {
        currentInvoice = mapInvoiceHeader(row, partners, warnings, rowNumber);
        invoices.push(currentInvoice);
        continue;
      }
      if (marker === "R02" && section === INVOICE_SECTION) {
        if (!currentInvoice) throw new Error(`Riadok ${rowNumber}: položka nemá nadradenú faktúru.`);
        currentInvoice.items.push(mapItem(row, warnings, rowNumber, currentInvoice.invoiceNumber));
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Riadok ${rowNumber}: neznáma chyba.`);
    }
  }

  for (const invoice of invoices) {
    if (invoice.items.length === 0) {
      errors.push(`Faktúra ${invoice.invoiceNumber} nemá žiadne položky.`);
      continue;
    }
    const itemTotal = invoice.items.reduce((sum, item) => sum + item.totalGrossCents, 0);
    if (itemTotal !== invoice.totalGrossCents) {
      errors.push(
        `Faktúra ${invoice.invoiceNumber}: súčet položiek ${itemTotal} centov sa nerovná hlavičke ${invoice.totalGrossCents} centov.`,
      );
    }
  }

  const externalIds = new Set<string>();
  for (const invoice of invoices) {
    if (externalIds.has(invoice.externalId)) errors.push(`Duplicitný externý identifikátor ${invoice.externalId}.`);
    externalIds.add(invoice.externalId);
  }

  const issued = invoices.filter((invoice) => invoice.direction === "VYDANA");
  const received = invoices.filter((invoice) => invoice.direction === "PRIJATA");
  const highestIssuedNumber =
    issued.map((invoice) => invoice.invoiceNumber).filter((number) => /^\d{7}$/.test(number)).sort().at(-1) ?? null;

  return {
    partners,
    invoices,
    warnings,
    errors,
    summary: {
      partnerCount: partners.length,
      invoiceCount: invoices.length,
      issuedInvoiceCount: issued.length,
      receivedInvoiceCount: received.length,
      itemCount: invoices.reduce((sum, invoice) => sum + invoice.items.length, 0),
      issuedGrossCents: issued.reduce((sum, invoice) => sum + invoice.totalGrossCents, 0),
      receivedGrossCents: received.reduce((sum, invoice) => sum + invoice.totalGrossCents, 0),
      totalGrossCents: invoices.reduce((sum, invoice) => sum + invoice.totalGrossCents, 0),
      highestIssuedNumber,
      nextIssuedNumber: nextIssuedNumber(highestIssuedNumber),
      warningCount: warnings.length,
      errorCount: errors.length,
    },
  };
}
