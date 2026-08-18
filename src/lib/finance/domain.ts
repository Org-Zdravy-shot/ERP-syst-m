import type {
  CalculateInvoiceInput,
  InvoiceCalculation,
  InvoiceDocumentStatus,
  InvoiceLineCalculation,
  InvoicePaymentStatus,
} from "./contracts";

export type FinanceDomainErrorCode =
  | "INVALID_CURRENCY"
  | "INVALID_LINE"
  | "INVALID_MONEY"
  | "INVALID_TRANSITION"
  | "INVOICE_NOT_FOUND"
  | "INVOICE_IMMUTABLE"
  | "ISSUING_GATE_BLOCKED"
  | "COUNTERPARTY_MISSING";

export class FinanceDomainError extends Error {
  constructor(
    public readonly code: FinanceDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FinanceDomainError";
  }
}

function assertSafeCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new FinanceDomainError("INVALID_MONEY", `${label} musí byť celé bezpečné číslo v centoch.`);
  }
}

function addSafeCents(left: number, right: number, label: string): number {
  const result = left + right;
  assertSafeCents(result, label);
  return result;
}

/**
 * Vypočíta sumy po položkách. Základ aj DPH sa zaokrúhlia na cent na každom
 * riadku a až potom sa sčítajú.
 */
export function calculateInvoice(input: CalculateInvoiceInput): InvoiceCalculation {
  if (input.currency !== "EUR") {
    throw new FinanceDomainError("INVALID_CURRENCY", "Prvá verzia financií podporuje iba EUR.");
  }
  if (input.lines.length === 0) {
    throw new FinanceDomainError("INVALID_LINE", "Faktúra musí mať aspoň jednu položku.");
  }

  let totalNetCents = 0;
  let totalVatCents = 0;
  let totalGrossCents = 0;

  const lines: InvoiceLineCalculation[] = input.lines.map((line, index) => {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new FinanceDomainError("INVALID_LINE", `Množstvo na riadku ${index + 1} musí byť kladné.`);
    }
    if (!line.description.trim() || !line.unit.trim()) {
      throw new FinanceDomainError("INVALID_LINE", `Riadok ${index + 1} nemá popis alebo jednotku.`);
    }
    assertSafeCents(line.unitPriceCents, `Jednotková cena na riadku ${index + 1}`);
    if (!Number.isInteger(line.vatRate) || line.vatRate < 0 || line.vatRate > 100) {
      throw new FinanceDomainError("INVALID_LINE", `Sadzba DPH na riadku ${index + 1} je neplatná.`);
    }
    if (line.taxCategory === "EXEMPT" && line.vatRate !== 0) {
      throw new FinanceDomainError("INVALID_LINE", `Oslobodený riadok ${index + 1} musí mať nulovú DPH.`);
    }

    const totalNet = Math.round(line.quantity * line.unitPriceCents);
    assertSafeCents(totalNet, `Základ na riadku ${index + 1}`);
    const totalVat = Math.round((totalNet * line.vatRate) / 100);
    assertSafeCents(totalVat, `DPH na riadku ${index + 1}`);
    const totalGross = addSafeCents(totalNet, totalVat, `Suma na riadku ${index + 1}`);

    totalNetCents = addSafeCents(totalNetCents, totalNet, "Celkový základ");
    totalVatCents = addSafeCents(totalVatCents, totalVat, "Celková DPH");
    totalGrossCents = addSafeCents(totalGrossCents, totalGross, "Celková suma");

    return {
      ...line,
      description: line.description.trim(),
      unit: line.unit.trim(),
      taxCategory: line.taxCategory ?? "STANDARD",
      lineNumber: index + 1,
      totalNetCents: totalNet,
      totalVatCents: totalVat,
      totalGrossCents: totalGross,
    };
  });

  return { currency: input.currency, lines, totalNetCents, totalVatCents, totalGrossCents };
}

export function calculatePaymentStatus(totalGrossCents: number, allocatedCents: number): InvoicePaymentStatus {
  assertSafeCents(totalGrossCents, "Suma faktúry");
  assertSafeCents(allocatedCents, "Alokovaná suma");
  if (totalGrossCents < 0 || allocatedCents < 0) {
    throw new FinanceDomainError("INVALID_MONEY", "Suma faktúry ani alokácie nesmie byť záporná.");
  }
  if (allocatedCents === 0) return totalGrossCents === 0 ? "PAID" : "UNPAID";
  if (allocatedCents < totalGrossCents) return "PARTIALLY_PAID";
  if (allocatedCents === totalGrossCents) return "PAID";
  return "OVERPAID";
}

export function assertCreditWithinOriginal(
  originalGrossCents: number,
  alreadyCreditedGrossCents: number,
  requestedGrossCents: number,
): void {
  assertSafeCents(originalGrossCents, "Suma pôvodnej faktúry");
  assertSafeCents(alreadyCreditedGrossCents, "Už dobropisovaná suma");
  assertSafeCents(requestedGrossCents, "Požadovaná suma dobropisu");
  if (originalGrossCents < 0 || alreadyCreditedGrossCents < 0 || requestedGrossCents <= 0) {
    throw new FinanceDomainError("INVALID_MONEY", "Sumy dobropisu musia byť kladné.");
  }
  if (alreadyCreditedGrossCents + requestedGrossCents > originalGrossCents) {
    throw new FinanceDomainError(
      "INVALID_MONEY",
      "Súčet dobropisov nesmie prekročiť sumu pôvodnej faktúry.",
    );
  }
}

const DOCUMENT_TRANSITIONS: Record<InvoiceDocumentStatus, readonly InvoiceDocumentStatus[]> = {
  DRAFT: ["ISSUED", "CANCELLED"],
  ISSUED: ["CANCELLED"],
  CANCELLED: [],
};

export function canTransitionDocument(
  from: InvoiceDocumentStatus,
  to: InvoiceDocumentStatus,
): boolean {
  return DOCUMENT_TRANSITIONS[from].includes(to);
}

export function assertDocumentTransition(
  from: InvoiceDocumentStatus,
  to: InvoiceDocumentStatus,
): void {
  if (!canTransitionDocument(from, to)) {
    throw new FinanceDomainError("INVALID_TRANSITION", `Prechod dokladu ${from} → ${to} nie je povolený.`);
  }
}

export function isDateWithinValidity(date: Date, validFrom: Date, validTo?: Date | null): boolean {
  const timestamp = date.getTime();
  return timestamp >= validFrom.getTime() && (!validTo || timestamp <= validTo.getTime());
}

export type DocumentNumberKind = "VYDANA" | "PRIJATA" | "OBJ" | "SARZA" | "NAKUP";

export function formatDocumentNumber(
  kind: DocumentNumberKind,
  year: number,
  sequence: number,
): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999 || !Number.isInteger(sequence) || sequence < 1) {
    throw new FinanceDomainError("INVALID_LINE", "Neplatný rok alebo poradové číslo dokladu.");
  }
  switch (kind) {
    case "VYDANA":
      return `${year}${String(sequence).padStart(3, "0")}`;
    case "PRIJATA":
      return `PF${year}${String(sequence).padStart(3, "0")}`;
    case "OBJ":
      return `OBJ${year}-${String(sequence).padStart(4, "0")}`;
    case "SARZA":
      return `S${year}-${String(sequence).padStart(4, "0")}`;
    case "NAKUP":
      return `NO${year}${String(sequence).padStart(3, "0")}`;
  }
}
