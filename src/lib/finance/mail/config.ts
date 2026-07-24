/**
 * Konfigurácia odosielania e-mailov. Tajomstvá (SMTP heslo) žijú výhradne
 * v Railway variables / .env — nikdy v kóde ani v databáze.
 * Poskytovateľ je vendor-neutrálny cez SMTP (nodemailer), aby sme sa
 * neviazali na jedného transakčného poskytovateľa.
 */

export const MAIL_FROM = process.env.MAIL_FROM?.trim() || "info@zdravyshot.sk";
export const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO?.trim() || MAIL_FROM;
export const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME?.trim() || "Zdravý Shot";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
}

export function smtpConfigured(): boolean {
  return !!process.env.SMTP_HOST && !!process.env.SMTP_PORT;
}

export function readSmtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  if (!host || !portRaw) {
    throw new Error("SMTP nie je nakonfigurované — nastav SMTP_HOST a SMTP_PORT.");
  }
  const port = Number.parseInt(portRaw, 10);
  return {
    host,
    port,
    secure: process.env.SMTP_SECURE === "1" || port === 465,
    user: process.env.SMTP_USER?.trim() || undefined,
    pass: process.env.SMTP_PASS?.trim() || undefined,
  };
}

/** Maximálny počet pokusov o odoslanie pred označením FAILED. */
export const MAIL_MAX_ATTEMPTS = 5;

/** Exponenciálny backoff (min) medzi pokusmi: 1, 5, 15, 60... */
export function mailBackoffMs(attempt: number): number {
  const minutes = [1, 5, 15, 60, 240][Math.min(attempt, 4)] ?? 240;
  return minutes * 60 * 1000;
}
