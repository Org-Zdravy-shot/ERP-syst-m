import { mailBackoffMs, MAIL_MAX_ATTEMPTS } from "@/lib/finance/mail/config";

export interface RetryDecision {
  action: "retry" | "fail";
  nextAttempts: number;
  delayMs: number;
}

/**
 * Čistá politika opakovania outbox udalosti. Po dosiahnutí maxAttempts sa
 * udalosť trvalo označí FAILED; inak sa naplánuje ďalší pokus s backoffom.
 */
export function decideRetry(currentAttempts: number, maxAttempts: number = MAIL_MAX_ATTEMPTS): RetryDecision {
  const nextAttempts = currentAttempts + 1;
  if (nextAttempts >= maxAttempts) {
    return { action: "fail", nextAttempts, delayMs: 0 };
  }
  return { action: "retry", nextAttempts, delayMs: mailBackoffMs(currentAttempts) };
}
