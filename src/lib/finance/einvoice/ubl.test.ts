import { describe, expect, it } from "vitest";
import type { InvoiceLineCalculation, PartySnapshot, TaxSnapshot } from "@/lib/finance/contracts";
import { renderPeppolBisUbl, UblGenerationError, type PeppolUblInput } from "./ubl";

const issuer: PartySnapshot = {
  name: "Zdravý Shot & Company s. r. o.",
  ico: "11223344",
  dic: "2020202020",
  icDph: "SK2020202020",
  email: "info@zdravyshot.sk",
  phone: "+421900111222",
  street: "Zdravá 1",
  city: "Bratislava",
  zip: "811 01",
  country: "SK",
  iban: "SK31 1100 0000 0029 1234 5678",
  bic: "TATRSKBX",
};

const buyer: PartySnapshot = {
  name: "Odberateľ <Test> s. r. o.",
  ico: "55667788",
  dic: "2123456789",
  icDph: "SK2123456789",
  email: "uctaren@example.sk",
  street: "Obchodná 5",
  city: "Košice",
  zip: "040 01",
  country: "SK",
};

const tax: TaxSnapshot = {
  vatStatus: "PAYER",
  vatRegisteredFrom: new Date("2026-10-01T00:00:00.000Z"),
  domesticTaxMode: "STANDARD",
  deliveryDate: new Date("2026-10-15T00:00:00.000Z"),
};

const lines: InvoiceLineCalculation[] = [
  {
    lineNumber: 1,
    productId: "product-1",
    productSku: "ZS-060",
    description: "Zázvorový shot & med",
    quantity: 10,
    unit: "ks",
    unitPriceCents: 200,
    vatRate: 23,
    taxCategory: "STANDARD",
    totalNetCents: 2_000,
    totalVatCents: 460,
    totalGrossCents: 2_460,
  },
  {
    lineNumber: 2,
    productId: "product-2",
    productSku: "ZS-500",
    description: "Test 5 %",
    quantity: 5,
    unit: "ks",
    unitPriceCents: 100,
    vatRate: 5,
    taxCategory: "STANDARD",
    totalNetCents: 500,
    totalVatCents: 25,
    totalGrossCents: 525,
  },
];

function invoice(overrides: Partial<PeppolUblInput> = {}): PeppolUblInput {
  return {
    id: "invoice-db-1",
    invoiceNumber: "2026009",
    documentType: "INVOICE",
    issueDate: new Date("2026-10-15T00:00:00.000Z"),
    dueDate: new Date("2026-10-29T00:00:00.000Z"),
    finalizedAt: new Date("2026-10-15T08:00:00.000Z"),
    currency: "EUR",
    variableSymbol: "2026009",
    note: "Ďakujeme <3 & dovidenia",
    issuer,
    counterparty: buyer,
    tax,
    lines,
    totalNetCents: 2_500,
    totalVatCents: 485,
    totalGrossCents: 2_985,
    sellerEndpoint: { schemeId: "0245", value: "2020202020" },
    buyerEndpoint: { schemeId: "0245", value: "2123456789" },
    buyerReference: "OBJ2026-0042",
    ...overrides,
  };
}

describe("Peppol BIS Billing 3.0 UBL", () => {
  it("vygeneruje deterministickú vydanú faktúru z nemenného snapshotu", () => {
    const first = renderPeppolBisUbl(invoice());
    const second = renderPeppolBisUbl(invoice());

    expect(first.xml).toContain('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
    expect(first.xml).toContain("urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0");
    expect(first.xml).toContain("<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>");
    expect(first.xml).toContain('<cbc:EndpointID schemeID="0245">2123456789</cbc:EndpointID>');
    expect(first.xml).toContain('<cbc:CompanyID schemeID="0158">11223344</cbc:CompanyID>');
    expect(first.xml).toContain('<cbc:InvoicedQuantity unitCode="C62">10</cbc:InvoicedQuantity>');
    expect(first.xml).toContain('<cbc:TaxAmount currencyID="EUR">4.85</cbc:TaxAmount>');
    expect(first.xml).toContain('<cbc:PayableAmount currencyID="EUR">29.85</cbc:PayableAmount>');
    expect(first.xml).toContain("Zdravý Shot &amp; Company");
    expect(first.xml).toContain("Odberateľ &lt;Test&gt;");
    expect(first.xml).not.toContain("<3 & dovidenia");
    expect(first.receiverPeppolId).toBe("0245:2123456789");
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.sha256).toBe(second.sha256);
    expect(first.idempotencyKey).toBe(`einvoice/invoice-db-1/${first.sha256}`);
    expect(Buffer.from(first.bytes).toString("utf8")).toBe(first.xml);
  });

  it("pre neplatiteľa použije výlučne kategóriu O bez percenta a VAT identifikátorov", () => {
    const nonPayerLine: InvoiceLineCalculation = {
      ...lines[0],
      quantity: 1,
      unitPriceCents: 1_000,
      vatRate: 0,
      totalNetCents: 1_000,
      totalVatCents: 0,
      totalGrossCents: 1_000,
    };
    const result = renderPeppolBisUbl(
      invoice({
        tax: { ...tax, vatStatus: "NON_PAYER", vatRegisteredFrom: undefined },
        lines: [nonPayerLine],
        totalNetCents: 1_000,
        totalVatCents: 0,
        totalGrossCents: 1_000,
      }),
    );

    expect(result.xml).toContain("<cbc:ID>O</cbc:ID>");
    expect(result.xml).toContain("<cbc:TaxExemptionReasonCode>VATEX-EU-O</cbc:TaxExemptionReasonCode>");
    expect(result.xml).not.toContain("<cbc:Percent>");
    expect(result.xml).not.toContain("SK2020202020");
    expect(result.xml).not.toContain("SK2123456789");
  });

  it("vygeneruje dobropis s väzbou na pôvodnú faktúru", () => {
    const result = renderPeppolBisUbl(
      invoice({
        documentType: "CREDIT_NOTE",
        invoiceNumber: "2026010",
        originalInvoiceNumber: "2026009",
        buyerReference: "REKLAMACIA-42",
      }),
    );

    expect(result.xml).toContain('<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"');
    expect(result.xml).toContain("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>");
    expect(result.xml).toContain("<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>2026009</cbc:ID>");
    expect(result.xml).toContain('<cbc:CreditedQuantity unitCode="C62">10</cbc:CreditedQuantity>');
    expect(result.xml).toContain("<cbc:PaymentDueDate>2026-10-29</cbc:PaymentDueDate>");
    expect(result.xml).not.toContain("<cbc:DueDate>");
  });

  it("zoskupí rozpis DPH podľa sadzby", () => {
    const xml = renderPeppolBisUbl(invoice()).xml;
    expect(xml.match(/<cac:TaxSubtotal>/g)).toHaveLength(2);
    expect(xml).toContain("<cbc:Percent>23</cbc:Percent>");
    expect(xml).toContain("<cbc:Percent>5</cbc:Percent>");
    expect(xml).toContain('<cbc:TaxableAmount currencyID="EUR">20.00</cbc:TaxableAmount>');
    expect(xml).toContain('<cbc:TaxableAmount currencyID="EUR">5.00</cbc:TaxableAmount>');
  });

  it("odmietne oslobodenie bez právneho dôvodu", () => {
    const exemptLine: InvoiceLineCalculation = {
      ...lines[0],
      taxCategory: "EXEMPT",
      vatRate: 0,
      totalVatCents: 0,
      totalGrossCents: 2_000,
    };
    expect(() =>
      renderPeppolBisUbl(
        invoice({
          lines: [exemptLine],
          totalNetCents: 2_000,
          totalVatCents: 0,
          totalGrossCents: 2_000,
        }),
      ),
    ).toThrow(/právny dôvod/);
  });

  it("odmietne chýbajúcu buyer reference, neznámu jednotku a nesúlad súčtov", () => {
    expect(() => renderPeppolBisUbl(invoice({ buyerReference: "" }))).toThrow(UblGenerationError);
    expect(() => renderPeppolBisUbl(invoice({ lines: [{ ...lines[0], unit: "bal" }, lines[1]] }))).toThrow(
      /nemá UBL kód/,
    );
    expect(() => renderPeppolBisUbl(invoice({ totalGrossCents: 2_984 }))).toThrow(/Súčty položiek/);
  });
});
