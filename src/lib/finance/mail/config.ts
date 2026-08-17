/**
 * Konfigurácia odosielania e-mailov. Tajomstvá (SMTP heslo/API kľúč) žijú výhradne
 * v Railway variables / .env — nikdy v kóde ani v databáze.
 * MailProvider ostáva vendor-neutrálny; produkcia môže použiť Resend HTTPS
 * API alebo SMTP na Railway Pro a vyššom pláne.
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

export interface ResendConfig {
  apiKey: string;
}

export type MailProviderKind = "RESEND" | "SMTP";

export function readResendConfig(env: NodeJS.ProcessEnv = process.env): ResendConfig {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Resend nie je nakonfigurovaný — nastav RESEND_API_KEY.");
  }
  return { apiKey };
}

export function resendConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    readResendConfig(env);
    return true;
  } catch {
    return false;
  }
}

export function resolveMailProviderKind(env: NodeJS.ProcessEnv = process.env): MailProviderKind {
  const configured = env.MAIL_PROVIDER?.trim().toUpperCase();
  if (configured === "RESEND" || configured === "SMTP") return configured;
  if (configured) {
    throw new Error("MAIL_PROVIDER musí byť RESEND alebo SMTP.");
  }
  return resendConfigured(env) ? "RESEND" : "SMTP";
}

export function smtpConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    readSmtpConfig(env);
    return true;
  } catch {
    return false;
  }
}

export function readSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const host = env.SMTP_HOST?.trim();
  const portRaw = env.SMTP_PORT?.trim();
  if (!host || !portRaw) {
    throw new Error("SMTP nie je nakonfigurované — nastav SMTP_HOST a SMTP_PORT.");
  }
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SMTP_PORT musí byť celé číslo od 1 do 65535.");
  }
  const user = env.SMTP_USER?.trim() || undefined;
  const pass = env.SMTP_PASS?.trim() || undefined;
  if (!!user !== !!pass) {
    throw new Error("SMTP_USER a SMTP_PASS musia byť nastavené spoločne.");
  }
  return {
    host,
    port,
    secure: env.SMTP_SECURE === "1" || port === 465,
    user,
    pass,
  };
}

export function mailProviderConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return resolveMailProviderKind(env) === "RESEND"
      ? resendConfigured(env)
      : smtpConfigured(env);
  } catch {
    return false;
  }
}

/** Maximálny počet pokusov o odoslanie pred označením FAILED. */
export const MAIL_MAX_ATTEMPTS = 5;

/** Exponenciálny backoff (min) medzi pokusmi: 1, 5, 15, 60... */
export function mailBackoffMs(attempt: number): number {
  const minutes = [1, 5, 15, 60, 240][Math.min(attempt, 4)] ?? 240;
  return minutes * 60 * 1000;
}
