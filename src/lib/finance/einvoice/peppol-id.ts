import type { EFakturaMode } from "./config";

export interface SlovakPeppolEndpoint {
  schemeId: "0245" | "9915";
  value: string;
  peppolId: string;
}

/**
 * eFaktura.sk smeruje slovenské subjekty podľa DIČ. Produkcia používa oficiálny
 * Peppol EAS 0245; sandbox providera používa jeho testovaciu schému 9915.
 */
export function slovakPeppolEndpoint(
  dic: string,
  mode: EFakturaMode,
): SlovakPeppolEndpoint {
  const normalized = dic.replaceAll(/\s/g, "");
  if (!/^\d{10}$/.test(normalized)) {
    throw new Error("Slovenský Peppol identifikátor vyžaduje DIČ s 10 číslicami.");
  }

  const schemeId = mode === "sandbox" ? "9915" : "0245";
  return {
    schemeId,
    value: normalized,
    peppolId: `${schemeId}:${normalized}`,
  };
}
