import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BankTransactionResult } from "@/lib/finance/contracts";
import { autoMatchPayment } from "@/lib/finance/matching/engine";
import { tatraPremiumEnabled } from "./flags";
import { decryptToken, encryptToken, TOKEN_KEY_VERSION } from "./tokenCrypto";
import { BankProviderError, TatraPremiumApiProvider } from "./tatraPremium";

/**
 * Sync vrstva: zápis bankových transakcií (idempotentne cez unikátnosť
 * [bankConnectionId, providerTransactionId]), tvorba Payment záznamov
 * a spustenie automatického párovania. Spúšťa sa z UI aj z Railway cronu
 * (POST /api/cron/bank-sync, každých 15 minút).
 */

export interface SyncSummary {
  connectionId: string;
  provider: string;
  imported: number;
  duplicates: number;
  autoMatched: number;
  manualReview: number;
  error?: string;
}

export type TransactionPersistenceDecision =
  | "CREATE_TRANSACTION"
  | "PROMOTE_TO_BOOKED"
  | "CREATE_MISSING_PAYMENT"
  | "DUPLICATE";

export function decideTransactionPersistence(
  existing: { status: string; hasPayment: boolean } | null,
  incomingStatus: "PENDING" | "BOOKED",
): TransactionPersistenceDecision {
  if (!existing) return "CREATE_TRANSACTION";
  if (existing.status === "PENDING" && incomingStatus === "BOOKED") return "PROMOTE_TO_BOOKED";
  if (incomingStatus === "BOOKED" && !existing.hasPayment) return "CREATE_MISSING_PAYMENT";
  return "DUPLICATE";
}

/** Zapíše stránku transakcií, vytvorí platby a spáruje ich. */
export async function persistTransactions(
  connectionId: string,
  transactions: BankTransactionResult[],
  paymentSource: "TATRA_PREMIUM" | "BANK_IMPORT",
): Promise<{ imported: number; duplicates: number; newPaymentIds: string[] }> {
  let imported = 0;
  let duplicates = 0;
  const newPaymentIds: string[] = [];

  for (const txn of transactions) {
    let result:
      | { created: false }
      | { created: true; paymentId: string | null };
    try {
      result = await prisma.$transaction(async (tx) => {
        const account = await tx.bankAccount.findFirst({
          where: {
            bankConnectionId: connectionId,
            OR: [{ providerAccountId: txn.providerAccountId }, { iban: txn.providerAccountId }],
          },
          select: { id: true },
        });
        if (!account) {
          throw new Error(`Bankový účet pre providerAccountId ${txn.providerAccountId} neexistuje.`);
        }

        const existing = await tx.bankTransaction.findUnique({
          where: {
            bankConnectionId_providerTransactionId: {
              bankConnectionId: connectionId,
              providerTransactionId: txn.providerTransactionId,
            },
          },
          select: { id: true, status: true, payment: { select: { id: true } } },
        });
        const decision = decideTransactionPersistence(
          existing ? { status: existing.status, hasPayment: existing.payment !== null } : null,
          txn.status,
        );
        if (decision === "DUPLICATE") return { created: false as const };

        const transactionData = {
          status: txn.status,
          bookingDate: txn.bookingDate,
          valueDate: txn.valueDate ?? null,
          amountCents: txn.amountCents,
          currency: txn.currency,
          counterpartyName: txn.counterpartyName ?? null,
          counterpartyIban: txn.counterpartyIban ?? null,
          variableSymbol: txn.variableSymbol ?? null,
          constantSymbol: txn.constantSymbol ?? null,
          specificSymbol: txn.specificSymbol ?? null,
          remittanceInfo: txn.remittanceInfo ?? null,
          rawPayload:
            txn.rawPayload === undefined ? undefined : JSON.parse(JSON.stringify(txn.rawPayload)),
        };

        const bankTransaction =
          decision === "CREATE_TRANSACTION"
            ? await tx.bankTransaction.create({
                data: {
                  bankConnectionId: connectionId,
                  bankAccountId: account.id,
                  providerTransactionId: txn.providerTransactionId,
                  ...transactionData,
                },
              })
            : decision === "PROMOTE_TO_BOOKED"
              ? await tx.bankTransaction.update({
                  where: { id: existing!.id },
                  data: { bankAccountId: account.id, ...transactionData },
                })
              : { id: existing!.id };

        // Platba vzniká len pre zaúčtované transakcie. Opakovaný sync zároveň
        // opraví starší BOOKED záznam bez platby a povýši PENDING → BOOKED.
        if (txn.status !== "BOOKED") return { created: true as const, paymentId: null };

        const paymentId =
          existing?.payment?.id ??
          (
            await tx.payment.create({
              data: {
                direction: txn.amountCents >= 0 ? "INCOMING" : "OUTGOING",
                source: paymentSource,
                amountCents: Math.abs(txn.amountCents),
                currency: txn.currency,
                paidAt: txn.valueDate ?? txn.bookingDate,
                reference: txn.remittanceInfo ?? null,
                variableSymbol: txn.variableSymbol ?? null,
                counterpartyName: txn.counterpartyName ?? null,
                counterpartyIban: txn.counterpartyIban ?? null,
                bankTransactionId: bankTransaction.id,
              },
            })
          ).id;
        return { created: true as const, paymentId };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        duplicates += 1;
        continue;
      }
      throw error;
    }

    if (!result.created) duplicates += 1;
    else {
      imported += 1;
      if (result.paymentId) newPaymentIds.push(result.paymentId);
    }
  }

  return { imported, duplicates, newPaymentIds };
}

async function matchNewPayments(paymentIds: string[]): Promise<{ autoMatched: number; manualReview: number }> {
  let autoMatched = 0;
  let manualReview = 0;
  for (const paymentId of paymentIds) {
    const { outcome, skipped } = await autoMatchPayment(paymentId);
    if (outcome.type === "AUTO") autoMatched += 1;
    else if (outcome.type === "MANUAL" && !skipped) manualReview += 1;
  }
  return { autoMatched, manualReview };
}

function buildProvider(connection: {
  id: string;
  encryptedRefreshToken: string | null;
}): TatraPremiumApiProvider {
  return new TatraPremiumApiProvider({
    apiBase: process.env.TATRA_API_BASE ?? "",
    clientId: process.env.TATRA_CLIENT_ID ?? "",
    clientSecret: process.env.TATRA_CLIENT_SECRET ?? "",
    getRefreshToken: async () => {
      if (!connection.encryptedRefreshToken) {
        throw new BankProviderError("REAUTH_REQUIRED", "Spojenie nemá uložený refresh token.");
      }
      return decryptToken(connection.encryptedRefreshToken);
    },
    onRefreshTokenRotated: async (newToken, expiresAt) => {
      const encrypted = encryptToken(newToken);
      connection.encryptedRefreshToken = encrypted;
      await prisma.bankConnection.update({
        where: { id: connection.id },
        data: { encryptedRefreshToken: encrypted, tokenKeyVersion: TOKEN_KEY_VERSION, tokenExpiresAt: expiresAt },
      });
    },
  });
}

/** Sync jedného Tatra spojenia — stránkuje od uloženého kurzora. */
async function syncTatraConnection(connectionId: string): Promise<SyncSummary> {
  const connection = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
  const summary: SyncSummary = {
    connectionId,
    provider: "TATRA_PREMIUM",
    imported: 0,
    duplicates: 0,
    autoMatched: 0,
    manualReview: 0,
  };

  const provider = buildProvider(connection);
  let cursor = connection.syncCursor ?? undefined;

  try {
    // Účty sa pri každom syncu doplnia/aktualizujú
    const accounts = await provider.listAccounts();
    for (const account of accounts) {
      const existingAccount = await prisma.bankAccount.findFirst({
        where: {
          iban: account.iban,
          currency: account.currency,
          OR: [{ bankConnectionId: connectionId }, { bankConnectionId: null }],
        },
        orderBy: { createdAt: "asc" },
      });
      if (existingAccount) {
        await prisma.bankAccount.update({
          where: { id: existingAccount.id },
          data: { bankConnectionId: connectionId, providerAccountId: account.providerAccountId, name: account.name },
        });
      } else {
        await prisma.bankAccount.create({ data: {
          bankConnectionId: connectionId,
          providerAccountId: account.providerAccountId,
          name: account.name,
          iban: account.iban,
          bic: account.bic ?? null,
          currency: account.currency,
        } });
      }
    }

    let hasMore = true;
    while (hasMore) {
      const page = await provider.syncTransactions(cursor);
      const { imported, duplicates, newPaymentIds } = await persistTransactions(
        connectionId,
        page.transactions,
        "TATRA_PREMIUM",
      );
      summary.imported += imported;
      summary.duplicates += duplicates;
      const matched = await matchNewPayments(newPaymentIds);
      summary.autoMatched += matched.autoMatched;
      summary.manualReview += matched.manualReview;

      cursor = page.nextCursor;
      hasMore = page.hasMore && !!page.nextCursor;

      await prisma.bankConnection.update({
        where: { id: connectionId },
        data: { syncCursor: cursor ?? null, lastSyncedAt: new Date(), status: "CONNECTED", lastError: null },
      });
    }
    // Ďalší beh začne opäť od začiatku okna (kurzor sa po dobehnutí čistí);
    // deduplikáciu zaručuje unikátnosť transakcií.
    await prisma.bankConnection.update({ where: { id: connectionId }, data: { syncCursor: null } });
  } catch (e) {
    const kind = e instanceof BankProviderError ? e.kind : "OUTAGE";
    const message = e instanceof Error ? e.message : String(e);
    summary.error = message;
    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: { status: kind === "REAUTH_REQUIRED" ? "REAUTH_REQUIRED" : "ERROR", lastError: message },
    });
  }

  await prisma.auditLog.create({
    data: {
      action: "BANK_SYNC",
      entityType: "BankConnection",
      entityId: connectionId,
      metadata: JSON.parse(JSON.stringify(summary)),
    },
  });

  return summary;
}

/** Vstupný bod pre cron aj UI tlačidlo „Synchronizovať teraz". */
export async function runBankSync(): Promise<SyncSummary[]> {
  if (!tatraPremiumEnabled()) return [];

  const connections = await prisma.bankConnection.findMany({
    where: { provider: "TATRA_PREMIUM", status: { in: ["CONNECTED", "ERROR"] } },
    select: { id: true },
  });

  const summaries: SyncSummary[] = [];
  for (const connection of connections) {
    summaries.push(await syncTatraConnection(connection.id));
  }
  return summaries;
}

/** Dočasný import výpisu: nájde/založí STATEMENT_IMPORT spojenie a účet. */
export async function importStatementTransactions(
  iban: string,
  transactions: BankTransactionResult[],
): Promise<SyncSummary> {
  const normalizedIban = iban.replace(/\s/g, "").toUpperCase();

  const connection =
    (await prisma.bankConnection.findFirst({ where: { provider: "STATEMENT_IMPORT" } })) ??
    (await prisma.bankConnection.create({
      data: { provider: "STATEMENT_IMPORT", status: "CONNECTED" },
    }));

  const existingAccount = await prisma.bankAccount.findFirst({
    where: {
      iban: normalizedIban,
      currency: "EUR",
      OR: [{ bankConnectionId: connection.id }, { bankConnectionId: null }],
    },
    orderBy: { createdAt: "asc" },
  });
  if (existingAccount) {
    await prisma.bankAccount.update({
      where: { id: existingAccount.id },
      data: { bankConnectionId: connection.id, providerAccountId: normalizedIban },
    });
  } else {
    await prisma.bankAccount.create({ data: {
      bankConnectionId: connection.id,
      providerAccountId: normalizedIban,
      name: `Účet ${normalizedIban.slice(-4)}`,
      iban: normalizedIban,
      currency: "EUR",
    } });
  }

  const withAccount = transactions.map((t) => ({ ...t, providerAccountId: normalizedIban }));
  const { imported, duplicates, newPaymentIds } = await persistTransactions(
    connection.id,
    withAccount,
    "BANK_IMPORT",
  );
  const matched = await matchNewPayments(newPaymentIds);

  const summary: SyncSummary = {
    connectionId: connection.id,
    provider: "STATEMENT_IMPORT",
    imported,
    duplicates,
    ...matched,
  };

  await prisma.bankConnection.update({
    where: { id: connection.id },
    data: { lastSyncedAt: new Date(), lastError: null },
  });
  await prisma.auditLog.create({
    data: {
      action: "BANK_STATEMENT_IMPORT",
      entityType: "BankConnection",
      entityId: connection.id,
      metadata: JSON.parse(JSON.stringify(summary)),
    },
  });

  return summary;
}
