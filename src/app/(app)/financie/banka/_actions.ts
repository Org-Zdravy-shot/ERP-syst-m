"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { importStatementTransactions, runBankSync } from "@/lib/finance/banking/sync";
import { tatraPremiumEnabled } from "@/lib/finance/banking/flags";
import { parseStatementCsv } from "@/lib/finance/banking/statement";
import { allocatePayment, reverseAllocation } from "@/lib/finance/matching/engine";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { parseEurToCents } from "@/lib/format";

export interface BankFormState {
  error?: string;
  success?: string;
}

/** Ručné spustenie synchronizácie z UI (rovnaká cesta ako cron). */
export async function triggerBankSync(_prev: BankFormState, _formData: FormData): Promise<BankFormState> {
  await requireFinancePermission("CONFIGURE");
  if (!tatraPremiumEnabled()) {
    return { error: "Tatra Premium API je vypnuté — chýba aktivácia/feature flag." };
  }
  const summaries = await runBankSync();
  revalidatePath("/financie/banka");
  revalidatePath("/financie/banka/parovanie");
  if (summaries.length === 0) return { success: "Žiadne aktívne bankové spojenie." };
  const total = summaries.reduce(
    (acc, s) => ({
      imported: acc.imported + s.imported,
      autoMatched: acc.autoMatched + s.autoMatched,
      manualReview: acc.manualReview + s.manualReview,
    }),
    { imported: 0, autoMatched: 0, manualReview: 0 },
  );
  const failed = summaries.filter((s) => s.error);
  const base = `Nové transakcie: ${total.imported} · spárované: ${total.autoMatched} · na kontrolu: ${total.manualReview}`;
  return failed.length > 0 ? { error: `${base} · chyby: ${failed.map((f) => f.error).join("; ")}` } : { success: base };
}

/** Parsovanie výpisu beží na serveri (node:crypto pre deterministické ID). */
export async function parseStatementAction(
  text: string,
  iban: string,
): Promise<
  | {
      transactions: Array<{
        providerTransactionId: string;
        providerAccountId: string;
        status: "PENDING" | "BOOKED";
        bookingDate: string;
        valueDate?: string;
        amountCents: number;
        currency: "EUR";
        counterpartyName?: string;
        counterpartyIban?: string;
        variableSymbol?: string;
        constantSymbol?: string;
        specificSymbol?: string;
        remittanceInfo?: string;
      }>;
      skippedLines: number;
    }
  | { error: string }
> {
  await requireFinancePermission("CONFIGURE");
  if (text.length > 5_000_000) {
    return { error: "Výpis je príliš veľký. Maximálna veľkosť je 5 MB." };
  }
  try {
    const result = parseStatementCsv(text, iban.replace(/\s/g, "").toUpperCase());
    return {
      transactions: result.transactions.map((t) => ({
        ...t,
        currency: "EUR" as const,
        bookingDate: t.bookingDate.toISOString(),
        valueDate: t.valueDate?.toISOString(),
        rawPayload: undefined,
      })),
      skippedLines: result.skippedLines,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Výpis sa nepodarilo spracovať." };
  }
}

const statementRowSchema = z.object({
  providerTransactionId: z.string().min(1).max(255),
  providerAccountId: z.string().min(1).max(100),
  status: z.enum(["PENDING", "BOOKED"]),
  bookingDate: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Neplatný dátum zaúčtovania."),
  valueDate: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Neplatný dátum valuty.")
    .optional(),
  amountCents: z.number().int().safe().refine((value) => value !== 0, "Suma transakcie nesmie byť nula."),
  currency: z.literal("EUR"),
  counterpartyName: z.string().max(255).optional(),
  counterpartyIban: z.string().max(100).optional(),
  variableSymbol: z.string().max(30).optional(),
  constantSymbol: z.string().max(30).optional(),
  specificSymbol: z.string().max(30).optional(),
  remittanceInfo: z.string().max(2_000).optional(),
});

/** Dočasný import bankového výpisu — riadky parsuje klient (preview), zapisuje server. */
export async function importStatement(_prev: BankFormState, formData: FormData): Promise<BankFormState> {
  await requireFinancePermission("CONFIGURE");

  const iban = String(formData.get("iban") ?? "").replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) {
    return { error: "Zadajte platný IBAN účtu, ku ktorému výpis patrí." };
  }

  let rowsRaw: unknown;
  try {
    rowsRaw = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { error: "Neplatné dáta výpisu." };
  }
  const rows = z.array(statementRowSchema).max(2000, "Naraz možno importovať max 2000 transakcií.").safeParse(rowsRaw);
  if (!rows.success) return { error: rows.error.issues[0]?.message ?? "Neplatné riadky výpisu." };
  if (rows.data.length === 0) return { error: "Výpis neobsahuje žiadne transakcie." };

  const summary = await importStatementTransactions(
    iban,
    rows.data.map((row) => ({
      ...row,
      bookingDate: new Date(row.bookingDate),
      valueDate: row.valueDate ? new Date(row.valueDate) : undefined,
    })),
  );

  revalidatePath("/financie/banka");
  revalidatePath("/financie/banka/parovanie");
  revalidatePath("/financie/cashflow");
  return {
    success: `Import hotový — nové: ${summary.imported}, duplikáty: ${summary.duplicates}, spárované: ${summary.autoMatched}, na kontrolu: ${summary.manualReview}.`,
  };
}

/** Manuálna alokácia platby na faktúru (aj čiastočná). */
export async function allocatePaymentAction(_prev: BankFormState, formData: FormData): Promise<BankFormState> {
  const user = await requireFinancePermission("ALLOCATE_PAYMENT");

  const paymentId = String(formData.get("paymentId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  let amountCents: number;
  try {
    amountCents = parseEurToCents(String(formData.get("amount") ?? ""));
  } catch {
    return { error: "Zadajte platnú kladnú sumu najviac s dvoma desatinnými miestami." };
  }

  if (!paymentId || !invoiceId) return { error: "Vyberte platbu aj faktúru." };
  if (amountCents <= 0) return { error: "Zadajte platnú kladnú sumu." };

  try {
    await allocatePayment(paymentId, invoiceId, amountCents, user.userId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Alokácia zlyhala." };
  }

  revalidatePath("/financie/banka");
  revalidatePath("/financie/banka/parovanie");
  revalidatePath("/financie/faktury");
  revalidatePath("/financie/cashflow");
  return { success: "Platba bola priradená k faktúre." };
}

export async function reverseAllocationAction(_prev: BankFormState, formData: FormData): Promise<BankFormState> {
  const user = await requireFinancePermission("ALLOCATE_PAYMENT");
  const allocationId = String(formData.get("allocationId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || "Manuálne zrušenie";
  if (reason.length > 500) return { error: "Dôvod zrušenia môže mať najviac 500 znakov." };

  try {
    await reverseAllocation(allocationId, user.userId, reason);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Zrušenie alokácie zlyhalo." };
  }

  revalidatePath("/financie/banka/parovanie");
  revalidatePath("/financie/faktury");
  return { success: "Alokácia bola zrušená." };
}
