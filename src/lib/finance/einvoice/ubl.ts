import { createHash } from "node:crypto";
import type { PartySnapshot } from "@/lib/finance/contracts";
import type { InvoicePdfData } from "@/lib/finance/documents/types";

const CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
const PROFILE_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const SLOVAK_ICO_SCHEME = "0158";

export class UblGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UblGenerationError";
  }
}

export interface PeppolEndpoint {
  /** EAS scheme, napr. 0245 pre slovenské DIČ. Hodnotu prideľuje provider. */
  schemeId: string;
  value: string;
}

export interface PeppolUblInput extends InvoicePdfData {
  sellerEndpoint: PeppolEndpoint;
  buyerEndpoint: PeppolEndpoint;
  /** Referencia dodaná kupujúcim alebo číslo jeho objednávky. */
  buyerReference: string;
  exemptionReasonCode?: string;
  exemptionReason?: string;
}

export interface RenderedPeppolUbl {
  xml: string;
  bytes: Uint8Array;
  sha256: string;
  idempotencyKey: string;
  receiverPeppolId: string;
}

type VatCategoryCode = "S" | "Z" | "E" | "O";

interface VatGroup {
  code: VatCategoryCode;
  rate: number;
  taxableCents: number;
  taxCents: number;
}

const UNIT_CODES: Readonly<Record<string, string>> = {
  ks: "C62",
  pc: "C62",
  pcs: "C62",
  kg: "KGM",
  g: "GRM",
  l: "LTR",
  ml: "MLT",
  hod: "HUR",
  h: "HUR",
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new UblGenerationError(`Chýba ${label}.`);
  return value.trim();
}

function element(name: string, value: string, attributes?: Record<string, string>): string {
  const attrs = attributes
    ? Object.entries(attributes)
        .map(([key, attribute]) => ` ${key}="${escapeXml(attribute)}"`)
        .join("")
    : "";
  return `<${name}${attrs}>${escapeXml(value)}</${name}>`;
}

function date(value: Date, label: string): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new UblGenerationError(`Neplatný ${label}.`);
  return value.toISOString().slice(0, 10);
}

function money(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new UblGenerationError("UBL obsahuje neplatnú sumu v centoch.");
  return (cents / 100).toFixed(2);
}

function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new UblGenerationError("UBL obsahuje neplatné množstvo.");
  return Number(value.toFixed(6)).toString();
}

function endpoint(value: PeppolEndpoint, label: string): PeppolEndpoint {
  const schemeId = text(value.schemeId, `schemeID ${label}`);
  const id = text(value.value, label);
  if (!/^\d{4}$/.test(schemeId)) throw new UblGenerationError(`schemeID ${label} musí mať štyri číslice.`);
  return { schemeId, value: id };
}

function completeSlovakParty(party: PartySnapshot, label: string): Required<Pick<PartySnapshot, "name" | "ico" | "dic" | "street" | "city" | "zip" | "country">> & PartySnapshot {
  const country = text(party.country, `krajina ${label}`).toUpperCase();
  if (country !== "SK") throw new UblGenerationError(`Prvá verzia UBL podporuje iba slovenský ${label}.`);
  const complete = {
    ...party,
    name: text(party.name, `názov ${label}`),
    ico: text(party.ico, `IČO ${label}`),
    dic: text(party.dic, `DIČ ${label}`),
    street: text(party.street, `ulica ${label}`),
    city: text(party.city, `mesto ${label}`),
    zip: text(party.zip, `PSČ ${label}`),
    country,
  };
  if (!/^\d{8}$/.test(complete.ico)) throw new UblGenerationError(`IČO ${label} musí mať 8 číslic.`);
  if (!/^\d{10}$/.test(complete.dic)) throw new UblGenerationError(`DIČ ${label} musí mať 10 číslic.`);
  if (complete.icDph && !/^SK\d{10}$/.test(complete.icDph.trim().toUpperCase())) {
    throw new UblGenerationError(`IČ DPH ${label} musí mať formát SK a 10 číslic.`);
  }
  return complete;
}

function partyXml(
  party: ReturnType<typeof completeSlovakParty>,
  partyEndpoint: PeppolEndpoint,
  includeVatIdentifier: boolean,
): string {
  const contact = [
    party.phone ? element("cbc:Telephone", party.phone.trim()) : "",
    party.email ? element("cbc:ElectronicMail", party.email.trim()) : "",
  ].filter(Boolean);
  const taxIdentifier = includeVatIdentifier && party.icDph
    ? party.icDph.trim()
    : party.dic;
  const taxScheme = includeVatIdentifier && party.icDph ? "VAT" : "TAX";

  return [
    "<cac:Party>",
    element("cbc:EndpointID", partyEndpoint.value, { schemeID: partyEndpoint.schemeId }),
    "<cac:PartyIdentification>",
    element("cbc:ID", party.ico, { schemeID: SLOVAK_ICO_SCHEME }),
    "</cac:PartyIdentification>",
    "<cac:PartyName>",
    element("cbc:Name", party.name),
    "</cac:PartyName>",
    "<cac:PostalAddress>",
    element("cbc:StreetName", party.street),
    element("cbc:CityName", party.city),
    element("cbc:PostalZone", party.zip),
    "<cac:Country>",
    element("cbc:IdentificationCode", party.country),
    "</cac:Country>",
    "</cac:PostalAddress>",
    "<cac:PartyTaxScheme>",
    element("cbc:CompanyID", taxIdentifier),
    "<cac:TaxScheme>",
    element("cbc:ID", taxScheme),
    "</cac:TaxScheme>",
    "</cac:PartyTaxScheme>",
    "<cac:PartyLegalEntity>",
    element("cbc:RegistrationName", party.name),
    element("cbc:CompanyID", party.ico, { schemeID: SLOVAK_ICO_SCHEME }),
    "</cac:PartyLegalEntity>",
    ...(contact.length > 0 ? ["<cac:Contact>", ...contact, "</cac:Contact>"] : []),
    "</cac:Party>",
  ].join("");
}

function categoryFor(input: PeppolUblInput, line: PeppolUblInput["lines"][number]): VatCategoryCode {
  if (input.tax.vatStatus === "NON_PAYER") return "O";
  if (line.taxCategory === "EXEMPT") return "E";
  return line.vatRate === 0 ? "Z" : "S";
}

function validateAndGroupVat(input: PeppolUblInput): VatGroup[] {
  if (input.lines.length === 0) throw new UblGenerationError("Faktúra nemá položky.");
  if (input.tax.vatStatus === "PAYER" && !input.issuer.icDph?.trim()) {
    throw new UblGenerationError("Platiteľovi DPH chýba IČ DPH v nemennom snapshot-e.");
  }
  if (input.tax.vatStatus === "NON_PAYER" && input.lines.some((line) => line.vatRate !== 0 || line.totalVatCents !== 0)) {
    throw new UblGenerationError("Neplatiteľ DPH nesmie mať v UBL vyčíslenú DPH.");
  }
  if (
    input.tax.vatStatus === "PAYER" &&
    input.lines.some((line) => line.taxCategory === "EXEMPT") &&
    !input.exemptionReasonCode?.trim() &&
    !input.exemptionReason?.trim()
  ) {
    throw new UblGenerationError("Oslobodená položka vyžaduje právny dôvod oslobodenia od DPH.");
  }

  const groups = new Map<string, VatGroup>();
  const lineNumbers = new Set<number>();
  for (const line of input.lines) {
    if (!Number.isInteger(line.lineNumber) || line.lineNumber < 1 || lineNumbers.has(line.lineNumber)) {
      throw new UblGenerationError("Riadky UBL musia mať jedinečné kladné poradové čísla.");
    }
    lineNumbers.add(line.lineNumber);
    if (!line.description.trim() || !Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new UblGenerationError(`Riadok ${line.lineNumber} nemá platný popis alebo množstvo.`);
    }
    if (!Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
      throw new UblGenerationError(`Riadok ${line.lineNumber} má neplatnú jednotkovú cenu.`);
    }
    if (!UNIT_CODES[line.unit.trim().toLowerCase()]) {
      throw new UblGenerationError(`Jednotka „${line.unit}“ na riadku ${line.lineNumber} nemá UBL kód.`);
    }
    if (![line.totalNetCents, line.totalVatCents, line.totalGrossCents].every(Number.isSafeInteger)) {
      throw new UblGenerationError(`Riadok ${line.lineNumber} má neplatné centové sumy.`);
    }
    if (line.totalGrossCents !== line.totalNetCents + line.totalVatCents) {
      throw new UblGenerationError(`Hrubá suma riadku ${line.lineNumber} nesedí so základom a DPH.`);
    }

    const code = categoryFor(input, line);
    if (code === "S" && line.vatRate <= 0) throw new UblGenerationError(`Štandardná DPH na riadku ${line.lineNumber} musí byť kladná.`);
    if ((code === "Z" || code === "E" || code === "O") && (line.vatRate !== 0 || line.totalVatCents !== 0)) {
      throw new UblGenerationError(`Nulová alebo oslobodená DPH na riadku ${line.lineNumber} musí byť 0.`);
    }

    const key = code === "O" ? code : `${code}:${line.vatRate}`;
    const group = groups.get(key) ?? { code, rate: line.vatRate, taxableCents: 0, taxCents: 0 };
    group.taxableCents += line.totalNetCents;
    group.taxCents += line.totalVatCents;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => `${left.code}:${left.rate}`.localeCompare(`${right.code}:${right.rate}`));
}

function taxCategoryXml(input: PeppolUblInput, group: VatGroup): string {
  return [
    "<cac:TaxCategory>",
    element("cbc:ID", group.code),
    ...(group.code === "O" ? [] : [element("cbc:Percent", String(group.rate))]),
    ...(group.code === "O" ? [element("cbc:TaxExemptionReasonCode", "VATEX-EU-O")] : []),
    ...(group.code === "E" && input.exemptionReasonCode?.trim()
      ? [element("cbc:TaxExemptionReasonCode", input.exemptionReasonCode.trim())]
      : []),
    ...(group.code === "E" && input.exemptionReason?.trim()
      ? [element("cbc:TaxExemptionReason", input.exemptionReason.trim())]
      : []),
    "<cac:TaxScheme>",
    element("cbc:ID", "VAT"),
    "</cac:TaxScheme>",
    "</cac:TaxCategory>",
  ].join("");
}

function lineXml(input: PeppolUblInput, line: PeppolUblInput["lines"][number]): string {
  const isCreditNote = input.documentType === "CREDIT_NOTE";
  const root = isCreditNote ? "cac:CreditNoteLine" : "cac:InvoiceLine";
  const quantityName = isCreditNote ? "cbc:CreditedQuantity" : "cbc:InvoicedQuantity";
  const category = categoryFor(input, line);
  const unitCode = UNIT_CODES[line.unit.trim().toLowerCase()];

  return [
    `<${root}>`,
    element("cbc:ID", String(line.lineNumber)),
    element(quantityName, decimal(line.quantity), { unitCode }),
    element("cbc:LineExtensionAmount", money(line.totalNetCents), { currencyID: "EUR" }),
    "<cac:Item>",
    element("cbc:Name", line.description.trim()),
    ...(line.productSku?.trim()
      ? ["<cac:SellersItemIdentification>", element("cbc:ID", line.productSku.trim()), "</cac:SellersItemIdentification>"]
      : []),
    "<cac:ClassifiedTaxCategory>",
    element("cbc:ID", category),
    ...(category === "O" ? [] : [element("cbc:Percent", String(line.vatRate))]),
    "<cac:TaxScheme>",
    element("cbc:ID", "VAT"),
    "</cac:TaxScheme>",
    "</cac:ClassifiedTaxCategory>",
    "</cac:Item>",
    "<cac:Price>",
    element("cbc:PriceAmount", money(line.unitPriceCents), { currencyID: "EUR" }),
    "</cac:Price>",
    `</${root}>`,
  ].join("");
}

export function renderPeppolBisUbl(input: PeppolUblInput): RenderedPeppolUbl {
  const invoiceNumber = text(input.invoiceNumber, "číslo faktúry");
  const buyerReference = text(input.buyerReference, "referencia kupujúceho");
  const sellerEndpoint = endpoint(input.sellerEndpoint, "predávajúceho");
  const buyerEndpoint = endpoint(input.buyerEndpoint, "kupujúceho");
  const issuer = completeSlovakParty(input.issuer, "predávajúceho");
  const counterparty = completeSlovakParty(input.counterparty, "kupujúceho");
  const groups = validateAndGroupVat(input);

  if (input.currency !== "EUR") throw new UblGenerationError("Prvá verzia UBL podporuje iba EUR.");
  if (input.documentType === "CREDIT_NOTE" && !input.originalInvoiceNumber?.trim()) {
    throw new UblGenerationError("Dobropis musí odkazovať na číslo pôvodnej faktúry.");
  }
  const issueDate = date(input.issueDate, "dátum vystavenia");
  const dueDate = date(input.dueDate, "dátum splatnosti");
  const deliveryDate = date(input.tax.deliveryDate, "dátum dodania");
  const iban = text(issuer.iban, "IBAN predávajúceho").replaceAll(" ", "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) throw new UblGenerationError("IBAN predávajúceho má neplatný formát.");
  if (issuer.bic && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(issuer.bic.trim().toUpperCase())) {
    throw new UblGenerationError("BIC predávajúceho má neplatný formát.");
  }

  const summed = input.lines.reduce(
    (result, line) => ({
      net: result.net + line.totalNetCents,
      vat: result.vat + line.totalVatCents,
      gross: result.gross + line.totalGrossCents,
    }),
    { net: 0, vat: 0, gross: 0 },
  );
  if (
    summed.net !== input.totalNetCents ||
    summed.vat !== input.totalVatCents ||
    summed.gross !== input.totalGrossCents ||
    input.totalGrossCents !== input.totalNetCents + input.totalVatCents
  ) {
    throw new UblGenerationError("Súčty položiek nesedia s nemenným snapshotom faktúry.");
  }

  const isCreditNote = input.documentType === "CREDIT_NOTE";
  const root = isCreditNote ? "CreditNote" : "Invoice";
  const namespace = `urn:oasis:names:specification:ubl:schema:xsd:${root}-2`;
  const typeCode = isCreditNote
    ? element("cbc:CreditNoteTypeCode", "381")
    : element("cbc:InvoiceTypeCode", "380");
  const taxTotals = groups.map((group) => [
    "<cac:TaxSubtotal>",
    element("cbc:TaxableAmount", money(group.taxableCents), { currencyID: "EUR" }),
    element("cbc:TaxAmount", money(group.taxCents), { currencyID: "EUR" }),
    taxCategoryXml(input, group),
    "</cac:TaxSubtotal>",
  ].join(""));

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${root} xmlns="${namespace}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`,
    element("cbc:CustomizationID", CUSTOMIZATION_ID),
    element("cbc:ProfileID", PROFILE_ID),
    element("cbc:ID", invoiceNumber),
    element("cbc:IssueDate", issueDate),
    ...(!isCreditNote ? [element("cbc:DueDate", dueDate)] : []),
    typeCode,
    ...(input.note?.trim() ? [element("cbc:Note", input.note.trim())] : []),
    element("cbc:DocumentCurrencyCode", "EUR"),
    element("cbc:BuyerReference", buyerReference),
    ...(isCreditNote
      ? [
          "<cac:BillingReference>",
          "<cac:InvoiceDocumentReference>",
          element("cbc:ID", input.originalInvoiceNumber!.trim()),
          "</cac:InvoiceDocumentReference>",
          "</cac:BillingReference>",
        ]
      : []),
    "<cac:AccountingSupplierParty>",
    partyXml(issuer, sellerEndpoint, input.tax.vatStatus === "PAYER"),
    "</cac:AccountingSupplierParty>",
    "<cac:AccountingCustomerParty>",
    partyXml(counterparty, buyerEndpoint, input.tax.vatStatus === "PAYER"),
    "</cac:AccountingCustomerParty>",
    "<cac:Delivery>",
    element("cbc:ActualDeliveryDate", deliveryDate),
    "</cac:Delivery>",
    "<cac:PaymentMeans>",
    element("cbc:PaymentMeansCode", "30", { name: "Credit transfer" }),
    ...(isCreditNote ? [element("cbc:PaymentDueDate", dueDate)] : []),
    element("cbc:PaymentID", input.variableSymbol?.trim() || invoiceNumber),
    "<cac:PayeeFinancialAccount>",
    element("cbc:ID", iban),
    element("cbc:Name", issuer.name),
    ...(issuer.bic?.trim()
      ? ["<cac:FinancialInstitutionBranch>", element("cbc:ID", issuer.bic.trim().toUpperCase()), "</cac:FinancialInstitutionBranch>"]
      : []),
    "</cac:PayeeFinancialAccount>",
    "</cac:PaymentMeans>",
    "<cac:TaxTotal>",
    element("cbc:TaxAmount", money(input.totalVatCents), { currencyID: "EUR" }),
    ...taxTotals,
    "</cac:TaxTotal>",
    "<cac:LegalMonetaryTotal>",
    element("cbc:LineExtensionAmount", money(input.totalNetCents), { currencyID: "EUR" }),
    element("cbc:TaxExclusiveAmount", money(input.totalNetCents), { currencyID: "EUR" }),
    element("cbc:TaxInclusiveAmount", money(input.totalGrossCents), { currencyID: "EUR" }),
    element("cbc:PayableAmount", money(input.totalGrossCents), { currencyID: "EUR" }),
    "</cac:LegalMonetaryTotal>",
    ...input.lines.map((line) => lineXml(input, line)),
    `</${root}>`,
  ].join("");

  const bytes = new TextEncoder().encode(xml);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    xml,
    bytes,
    sha256,
    idempotencyKey: `einvoice/${input.id}/${sha256}`,
    receiverPeppolId: `${buyerEndpoint.schemeId}:${buyerEndpoint.value}`,
  };
}
