import QRCode from "qrcode";
import { DocumentGenerationError } from "./errors";
import type { InvoicePdfData } from "./types";

export async function isPayBySquareBankAccount(iban: string, bic?: string | null): Promise<boolean> {
  const { validateBankAccount } = await import("bysquare/pay");
  try {
    validateBankAccount({
      iban: iban.replace(/\s+/g, "").toUpperCase(),
      bic: bic?.replace(/\s+/g, "").toUpperCase(),
    }, "bankAccount");
    return true;
  } catch {
    return false;
  }
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function normalizedVariableSymbol(data: InvoicePdfData): string | undefined {
  const candidate = data.variableSymbol ?? data.invoiceNumber;
  return /^\d{1,10}$/.test(candidate) ? candidate : undefined;
}

export async function createPayBySquarePayload(
  data: InvoicePdfData,
): Promise<string | null> {
  if (data.documentType !== "INVOICE" || data.totalGrossCents <= 0 || !data.issuer.iban) {
    return null;
  }

  try {
    // bysquare je ESM-only; dynamický import zachová ESM cestu aj pri Node testoch.
    const { CurrencyCode, encode, PaymentOptions } = await import("bysquare/pay");
    return encode({
      invoiceId: data.invoiceNumber.slice(0, 10),
      payments: [
        {
          type: PaymentOptions.PaymentOrder,
          amount: data.totalGrossCents / 100,
          currencyCode: CurrencyCode.EUR,
          paymentDueDate: formatDate(data.dueDate),
          variableSymbol: normalizedVariableSymbol(data),
          paymentNote: `Úhrada faktúry ${data.invoiceNumber}`.slice(0, 140),
          beneficiary: {
            name: data.issuer.name.slice(0, 70),
            street: data.issuer.street?.slice(0, 70),
            city: data.issuer.city?.slice(0, 70),
          },
          bankAccounts: [
            {
              iban: data.issuer.iban.replace(/\s+/g, "").toUpperCase(),
              bic: data.issuer.bic?.replace(/\s+/g, "").toUpperCase(),
            },
          ],
        },
      ],
    });
  } catch (error) {
    throw new DocumentGenerationError(
      "Platobný QR kód sa nepodarilo vytvoriť. Skontrolujte IBAN, BIC a variabilný symbol.",
      { cause: error },
    );
  }
}

export async function createPayBySquarePng(data: InvoicePdfData): Promise<string | null> {
  const payload = await createPayBySquarePayload(data);
  if (!payload) return null;

  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 440,
    color: {
      dark: "#111827",
      light: "#FFFFFF",
    },
  });
}
