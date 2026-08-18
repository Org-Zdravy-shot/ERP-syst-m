export type SupplierOrderStatus =
  | "DRAFT"
  | "APPROVED"
  | "SENT"
  | "CONFIRMED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

export type SupplierPriceType = "NET" | "GROSS";

export class SupplierDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplierDomainError";
  }
}

const ORDER_TRANSITIONS: Record<SupplierOrderStatus, readonly SupplierOrderStatus[]> = {
  DRAFT: ["APPROVED", "CANCELLED"],
  APPROVED: ["SENT", "CANCELLED"],
  SENT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["RECEIVED"],
  RECEIVED: [],
  CANCELLED: [],
};

export function canTransitionSupplierOrder(
  from: SupplierOrderStatus,
  to: SupplierOrderStatus,
): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function assertSupplierOrderTransition(
  from: SupplierOrderStatus,
  to: SupplierOrderStatus,
): void {
  if (!canTransitionSupplierOrder(from, to)) {
    throw new SupplierDomainError(`Prechod nákupnej objednávky ${from} → ${to} nie je povolený.`);
  }
}

function assertSafeCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new SupplierDomainError(`${label} musí byť celé bezpečné číslo v centoch.`);
  }
}

function addSafeCents(left: number, right: number, label: string): number {
  const value = left + right;
  assertSafeCents(value, label);
  return value;
}

export interface SupplierOrderLineInput {
  quantity: number;
  unitPriceCents: number;
  pricePerQuantity?: number;
  priceType: SupplierPriceType;
  vatRate: number;
}

export interface SupplierOrderLineTotal extends SupplierOrderLineInput {
  totalNetCents: number;
  totalVatCents: number;
  totalGrossCents: number;
}

export interface SupplierOrderTotals {
  lines: SupplierOrderLineTotal[];
  totalNetCents: number;
  totalVatCents: number;
  totalGrossCents: number;
}

/**
 * Nákupná cena môže byť netto alebo brutto. Každý riadok sa zaokrúhli na cent
 * pred sčítaním, aby história objednávky zostala reprodukovateľná.
 */
export function calculateSupplierOrderTotals(
  lines: SupplierOrderLineInput[],
  shippingCents = 0,
  discountCents = 0,
): SupplierOrderTotals {
  if (lines.length === 0) throw new SupplierDomainError("Nákupná objednávka musí mať aspoň jednu položku.");
  assertSafeCents(shippingCents, "Doprava");
  assertSafeCents(discountCents, "Zľava");
  if (shippingCents < 0 || discountCents < 0) {
    throw new SupplierDomainError("Doprava ani zľava nesmú byť záporné.");
  }

  let totalNetCents = 0;
  let totalVatCents = 0;
  let totalGrossCents = 0;

  const calculated = lines.map((line, index): SupplierOrderLineTotal => {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new SupplierDomainError(`Množstvo na riadku ${index + 1} musí byť kladné.`);
    }
    assertSafeCents(line.unitPriceCents, `Cena na riadku ${index + 1}`);
    if (line.unitPriceCents < 0) {
      throw new SupplierDomainError(`Cena na riadku ${index + 1} nesmie byť záporná.`);
    }
    const pricePerQuantity = line.pricePerQuantity ?? 1;
    if (!Number.isFinite(pricePerQuantity) || pricePerQuantity <= 0) {
      throw new SupplierDomainError(`Cenová jednotka na riadku ${index + 1} musí byť kladná.`);
    }
    if (!Number.isInteger(line.vatRate) || line.vatRate < 0 || line.vatRate > 100) {
      throw new SupplierDomainError(`DPH na riadku ${index + 1} je neplatná.`);
    }

    let totalNet: number;
    let totalVat: number;
    let totalGross: number;
    if (line.priceType === "NET") {
      totalNet = Math.round((line.quantity / pricePerQuantity) * line.unitPriceCents);
      totalVat = Math.round((totalNet * line.vatRate) / 100);
      totalGross = addSafeCents(totalNet, totalVat, `Suma na riadku ${index + 1}`);
    } else if (line.priceType === "GROSS") {
      totalGross = Math.round((line.quantity / pricePerQuantity) * line.unitPriceCents);
      totalNet = Math.round((totalGross * 100) / (100 + line.vatRate));
      totalVat = totalGross - totalNet;
    } else {
      throw new SupplierDomainError(`Typ ceny na riadku ${index + 1} je neplatný.`);
    }
    assertSafeCents(totalNet, `Základ na riadku ${index + 1}`);
    assertSafeCents(totalVat, `DPH na riadku ${index + 1}`);
    assertSafeCents(totalGross, `Suma na riadku ${index + 1}`);

    totalNetCents = addSafeCents(totalNetCents, totalNet, "Celkový základ");
    totalVatCents = addSafeCents(totalVatCents, totalVat, "Celková DPH");
    totalGrossCents = addSafeCents(totalGrossCents, totalGross, "Celková suma");
    return {
      ...line,
      totalNetCents: totalNet,
      totalVatCents: totalVat,
      totalGrossCents: totalGross,
    };
  });

  totalGrossCents = addSafeCents(totalGrossCents, shippingCents, "Celková suma s dopravou");
  totalGrossCents = addSafeCents(totalGrossCents, -discountCents, "Celková suma po zľave");
  if (totalGrossCents < 0) throw new SupplierDomainError("Zľava nesmie prekročiť sumu objednávky a dopravy.");

  return { lines: calculated, totalNetCents, totalVatCents, totalGrossCents };
}

export interface SupplierPriceCandidate {
  unitPriceCents: number;
  minimumQuantity: number;
  validFrom: Date;
  validTo?: Date | null;
}

/** Vyberie najvyšší platný množstevný stupeň, pri zhode najnovšiu cenu. */
export function selectActiveSupplierPrice<T extends SupplierPriceCandidate>(
  prices: readonly T[],
  quantity: number,
  at: Date,
): T | null {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new SupplierDomainError("Množstvo pre výber ceny je neplatné.");
  }
  const timestamp = at.getTime();
  return (
    prices
      .filter(
        (price) =>
          price.minimumQuantity <= quantity &&
          price.validFrom.getTime() <= timestamp &&
          (!price.validTo || price.validTo.getTime() >= timestamp),
      )
      .sort(
        (left, right) =>
          right.minimumQuantity - left.minimumQuantity ||
          right.validFrom.getTime() - left.validFrom.getTime(),
      )[0] ?? null
  );
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b > 0) [a, b] = [b, a % b];
  return a;
}

function commonQuantityStep(packQuantity: number, orderMultiple: number): number {
  const scale = 1_000_000;
  const pack = Math.round(packQuantity * scale);
  const multiple = Math.round(orderMultiple * scale);
  if (pack <= 0 || multiple <= 0) throw new SupplierDomainError("Balenie a násobok objednávky musia byť kladné.");
  const result = (pack / greatestCommonDivisor(pack, multiple)) * multiple;
  if (!Number.isSafeInteger(result)) throw new SupplierDomainError("Kombinácia balenia a násobku je príliš veľká.");
  return result / scale;
}

export interface ReplenishmentInput {
  currentQuantity: number;
  openOrderQuantity: number;
  minStock: number;
  targetStock?: number | null;
  minOrderQuantity: number;
  packQuantity: number;
  orderMultiple: number;
}

/**
 * Vráti 0, ak netreba objednať. Inak doplní stav po cieľ a výsledok zaokrúhli
 * nahor na spoločný násobok balenia a objednávkového kroku.
 */
export function recommendedOrderQuantity(input: ReplenishmentInput): number {
  const values = Object.values(input).filter((value): value is number => typeof value === "number");
  if (values.some((value) => !Number.isFinite(value))) {
    throw new SupplierDomainError("Údaje pre doobjednanie musia byť konečné čísla.");
  }
  if (
    input.openOrderQuantity < 0 ||
    input.minStock < 0 ||
    (input.targetStock !== null && input.targetStock !== undefined && input.targetStock < 0) ||
    input.minOrderQuantity < 0
  ) {
    throw new SupplierDomainError("Limity zásob a objednávok nesmú byť záporné.");
  }

  const available = input.currentQuantity + input.openOrderQuantity;
  if (available >= input.minStock) return 0;
  const target = Math.max(input.minStock, input.targetStock ?? input.minStock);
  const needed = Math.max(target - available, input.minOrderQuantity);
  const step = commonQuantityStep(input.packQuantity, input.orderMultiple);
  const rounded = Math.ceil((needed - Number.EPSILON) / step) * step;
  return Math.round(rounded * 1_000_000) / 1_000_000;
}

export function supplierReturnableBalance(movements: readonly number[]): number {
  const balance = movements.reduce((sum, quantity) => {
    if (!Number.isFinite(quantity) || quantity === 0) {
      throw new SupplierDomainError("Pohyb vratného obalu musí byť nenulové konečné číslo.");
    }
    return sum + quantity;
  }, 0);
  return Math.round(balance * 1_000_000) / 1_000_000;
}

export function supplierManualAccountBalance(entries: readonly number[]): number {
  return entries.reduce((sum, amount) => {
    assertSafeCents(amount, "Pohyb záväzku");
    if (amount === 0) throw new SupplierDomainError("Pohyb záväzku nesmie byť nulový.");
    return addSafeCents(sum, amount, "Zostatok záväzku");
  }, 0);
}

export interface SupplierInvoiceBalanceInput {
  documentType: "INVOICE" | "CREDIT_NOTE";
  documentStatus: "DRAFT" | "ISSUED" | "CANCELLED";
  totalGrossCents: number;
  allocatedCents: number;
}

/** Kladný výsledok dlhujeme dodávateľovi, záporný dodávateľ dlhuje nám. */
export function supplierInvoiceBalance(invoices: readonly SupplierInvoiceBalanceInput[]): number {
  return invoices.reduce((sum, invoice) => {
    assertSafeCents(invoice.totalGrossCents, "Suma prijatej faktúry");
    assertSafeCents(invoice.allocatedCents, "Úhrada prijatej faktúry");
    if (invoice.totalGrossCents < 0 || invoice.allocatedCents < 0) {
      throw new SupplierDomainError("Faktúra ani jej úhrada nesmú byť záporné.");
    }
    if (invoice.documentStatus !== "ISSUED") return sum;
    const outstanding = invoice.totalGrossCents - invoice.allocatedCents;
    const signed = invoice.documentType === "CREDIT_NOTE" ? -outstanding : outstanding;
    return addSafeCents(sum, signed, "Zostatok prijatých faktúr");
  }, 0);
}

export interface SupplierReceiptLine {
  orderedQuantity: number;
  receivedQuantity: number;
}

export function deriveSupplierOrderReceiptStatus(
  lines: readonly SupplierReceiptLine[],
): "CONFIRMED" | "PARTIALLY_RECEIVED" | "RECEIVED" {
  if (lines.length === 0) throw new SupplierDomainError("Objednávka nemá položky.");
  const epsilon = 1e-9;
  let hasReceived = false;
  let allReceived = true;
  for (const [index, line] of lines.entries()) {
    if (
      !Number.isFinite(line.orderedQuantity) ||
      !Number.isFinite(line.receivedQuantity) ||
      line.orderedQuantity <= 0 ||
      line.receivedQuantity < 0
    ) {
      throw new SupplierDomainError(`Množstvá na riadku ${index + 1} sú neplatné.`);
    }
    if (line.receivedQuantity - line.orderedQuantity > epsilon) {
      throw new SupplierDomainError(`Príjem na riadku ${index + 1} prekračuje objednané množstvo.`);
    }
    hasReceived ||= line.receivedQuantity > epsilon;
    allReceived &&= Math.abs(line.receivedQuantity - line.orderedQuantity) <= epsilon;
  }
  if (allReceived) return "RECEIVED";
  return hasReceived ? "PARTIALLY_RECEIVED" : "CONFIRMED";
}
