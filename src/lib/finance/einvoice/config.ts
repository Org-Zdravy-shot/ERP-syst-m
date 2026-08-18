const DEFAULT_EFAKTURA_API_BASE = "https://api.efaktura.sk/v1";

type EFakturaEnv = Readonly<Record<string, string | undefined>>;

export type EFakturaMode = "sandbox" | "production";

export interface EFakturaConfig {
  apiBase: string;
  apiKey: string;
  organizationId: string;
  webhookSecret?: string;
  mode: EFakturaMode;
}

function resolveMode(apiKey: string): EFakturaMode {
  if (apiKey.startsWith("efk_pk_test_")) return "sandbox";
  if (apiKey.startsWith("efk_pk_live_")) return "production";
  throw new Error("EFAKTURA_API_KEY musí byť testovací alebo produkčný kľúč eFaktura.sk.");
}

export function einvoiceEnabled(env: EFakturaEnv = process.env): boolean {
  return env.EINVOICE_ENABLED === "1";
}

/**
 * Fail-closed konfigurácia. Sandbox stačí explicitne zapnúť, ale live kľúč
 * navyše vyžaduje dve nezávislé produkčné brány.
 */
export function readEFakturaConfig(env: EFakturaEnv = process.env): EFakturaConfig {
  if (!einvoiceEnabled(env)) {
    throw new Error("eFaktúra je vypnutá — nastav EINVOICE_ENABLED=1 až pre sandbox test.");
  }

  const apiKey = env.EFAKTURA_API_KEY?.trim();
  const organizationId = env.EFAKTURA_ORGANIZATION_ID?.trim();
  if (!apiKey) throw new Error("Chýba EFAKTURA_API_KEY.");
  if (!organizationId) throw new Error("Chýba EFAKTURA_ORGANIZATION_ID.");

  const mode = resolveMode(apiKey);
  if (
    mode === "production" &&
    (env.EINVOICE_LIVE_ENABLED !== "1" || env.FINANCE_PRODUCTION_ISSUING_ENABLED !== "true")
  ) {
    throw new Error(
      "Produkčná eFaktúra je zablokovaná — vyžaduje EINVOICE_LIVE_ENABLED=1 aj FINANCE_PRODUCTION_ISSUING_ENABLED=true.",
    );
  }

  return {
    apiBase: (env.EFAKTURA_API_BASE?.trim() || DEFAULT_EFAKTURA_API_BASE).replace(/\/+$/, ""),
    apiKey,
    organizationId,
    webhookSecret: env.EFAKTURA_WEBHOOK_SECRET?.trim() || undefined,
    mode,
  };
}

export function efakturaMissingConfig(env: EFakturaEnv = process.env): string[] {
  const missing: string[] = [];
  if (!einvoiceEnabled(env)) missing.push("EINVOICE_ENABLED=1");
  if (!env.EFAKTURA_API_KEY?.trim()) missing.push("EFAKTURA_API_KEY");
  if (!env.EFAKTURA_ORGANIZATION_ID?.trim()) missing.push("EFAKTURA_ORGANIZATION_ID");
  return missing;
}
