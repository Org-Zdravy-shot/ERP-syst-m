import { z } from "zod";
import type { CompanyMatch } from "./company-lookup";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const validity = { validFrom: date.nullish(), validTo: date.nullish() };
const timedText = z.object({ ...validity, value: z.string().trim() });
const codeValue = z.object({ value: z.string().nullish(), code: z.string().nullish() });
const address = z.object({
  ...validity,
  street: z.string().trim().nullish(),
  regNumber: z.number().int().nonnegative().nullish(),
  buildingNumber: z.string().trim().nullish(),
  postalCodes: z.array(z.string()).nullish(),
  municipality: codeValue.nullish(),
  country: codeValue.nullish(),
  addressLine: z.string().trim().nullish(),
});
const result = z.object({
  id: z.number().int().positive(),
  identifiers: z.array(timedText),
  fullNames: z.array(timedText),
  addresses: z.array(address).nullish(),
  establishment: date.nullish(),
  termination: date.nullish(),
  dbModificationDate: date.nullish(),
});
const searchResponse = z.object({ results: z.array(z.unknown()).max(500) });

function current<T extends { validFrom?: string | null; validTo?: string | null }>(entries: T[], at: string): T | undefined {
  return entries
    .filter((entry) => (!entry.validFrom || entry.validFrom <= at) && (!entry.validTo || entry.validTo >= at))
    .sort((a, b) => (b.validFrom ?? "").localeCompare(a.validFrom ?? ""))[0];
}

function normalizedName(value: string): string {
  return value.toLocaleLowerCase("sk").normalize("NFD").replace(/\p{M}/gu, "");
}

export function mapRpoResults(payload: unknown, query: string, at: string): CompanyMatch[] {
  const exactIco = /^[\d\s]+$/.test(query) ? query.replace(/\s/g, "") : undefined;
  const term = normalizedName(query);
  const unique = new Map<string, CompanyMatch>();
  for (const raw of searchResponse.parse(payload).results) {
    const parsed = result.safeParse(raw);
    if (!parsed.success) continue;
    const row = parsed.data;
    if ((row.establishment && row.establishment > at) || (row.termination && row.termination <= at)) continue;
    const ico = current(row.identifiers, at)?.value;
    const name = current(row.fullNames, at)?.value;
    if (!ico || !/^\d{8}$/.test(ico) || ico === "00000000" || !name || name.length > 255) continue;
    if (exactIco ? ico !== exactIco : !normalizedName(name).includes(term)) continue;
    if (unique.has(ico)) continue;

    const office = current(row.addresses ?? [], at);
    const country = office?.country;
    if (country?.code && country.code !== "703" && country.code !== "SK") continue;
    if (!country?.code && country?.value && !["Slovenská republika", "Slovensko", "SK"].includes(country.value)) continue;
    const number = [office?.regNumber || "", office?.buildingNumber].filter(Boolean).join("/");
    const street = office?.addressLine || [
      office?.street || (!office?.street ? office?.municipality?.value : ""),
      number,
    ].filter(Boolean).join(" ");
    unique.set(ico, {
      id: `rpo:${row.id}`,
      source: "RPO",
      name,
      ico,
      dic: "",
      icDph: "",
      street: street.slice(0, 255),
      city: office?.municipality?.value?.trim().slice(0, 120) ?? "",
      zip: office?.postalCodes?.[0]?.trim().slice(0, 20) ?? "",
      country: "SK",
      updatedAt: row.dbModificationDate ?? undefined,
    });
  }
  return [...unique.values()].sort((a, b) =>
    Number(normalizedName(b.name).startsWith(term)) - Number(normalizedName(a.name).startsWith(term))
    || a.name.localeCompare(b.name, "sk"),
  ).slice(0, 5);
}

const urlBase = "https://api.statistics.sk/rpo/v1/search";
const busy = "Verejný register má práve obmedzený počet vyhľadávaní. Skúste o chvíľu alebo vyplňte údaje ručne.";
let pausedUntil = 0;

export async function lookupRpo(query: string, fetcher: typeof fetch = fetch): Promise<CompanyMatch[]> {
  const term = query.trim().replace(/\s+/g, " ");
  if (term.length < 3 || term.length > 100) return [];
  const numeric = /^[\d\s]+$/.test(term);
  const normalized = numeric ? term.replace(/\s/g, "") : term;
  if (numeric && !/^\d{8}$/.test(normalized)) return [];
  if (Date.now() < pausedUntil) throw new Error(busy);

  const url = new URL(urlBase);
  url.searchParams.set(numeric ? "identifier" : "fullName", normalized);
  url.searchParams.set("onlyActive", "true");
  let response: Response;
  try {
    response = await fetcher(url, {
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("Verejný register firiem je dočasne nedostupný. Údaje môžete vyplniť ručne.");
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 30;
    pausedUntil = Date.now() + Math.min(300, Math.max(10, seconds)) * 1000;
    throw new Error(busy);
  }
  if (!response.ok) throw new Error("Verejný register firiem je dočasne nedostupný. Údaje môžete vyplniť ručne.");
  const at = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bratislava" }).format();
  try {
    return mapRpoResults(await response.json(), term, at);
  } catch {
    throw new Error("Odpoveď verejného registra sa nepodarilo načítať. Údaje môžete vyplniť ručne.");
  }
}
