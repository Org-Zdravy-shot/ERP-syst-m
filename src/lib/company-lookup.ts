import { z } from "zod";

export interface CompanyMatch {
  id: string;
  clientId?: string;
  name: string;
  ico: string;
  dic: string;
  icDph: string;
  street: string;
  city: string;
  zip: string;
  country: string;
  source: "ERP" | "AUTOFORM";
  updatedAt?: string;
}

const value = z.union([z.string(), z.number()]).nullish().transform((v) => v == null ? "" : String(v).trim());
const company = z.object({
  id: z.union([z.string(), z.number()]), name: z.string().trim().min(1).max(255),
  cin: value, tin: value, vatin: value, formatted_street: value,
  street: value, street_number: value, reg_number: value, building_number: value,
  municipality: value, postal_code: value, country: value, updated_at: value,
  terminated_on: value,
});

export function mapAutoformResults(payload: unknown): CompanyMatch[] {
  const rows = z.array(company).max(20).parse(payload);
  return rows.filter((row) => !row.terminated_on).map((row) => {
    const ico = row.cin.replace(/\s/g, "").padStart(8, "0");
    if (!/^\d{8}$/.test(ico)) throw new Error("Register vrátil neplatné IČO.");
    const number = row.street_number || [row.reg_number, row.building_number].filter(Boolean).join("/");
    const dic = row.tin.replace(/\s/g, "");
    const icDph = row.vatin.replace(/\s/g, "").toUpperCase();
    return {
      id: `autoform:${row.id}`, name: row.name, ico,
      dic: /^\d{10}$/.test(dic) ? dic : "",
      icDph: /^SK\d{10}$/.test(icDph) ? icDph : "",
      street: row.formatted_street || [row.street, number].filter(Boolean).join(" "),
      city: row.municipality, zip: row.postal_code,
      country: ["SK", "Slovensko", "Slovenská republika"].includes(row.country) ? "SK" : row.country,
      source: "AUTOFORM", updatedAt: row.updated_at || undefined,
    };
  });
}

export async function lookupAutoform(query: string, options: { apiKey?: string; fetcher?: typeof fetch } = {}): Promise<CompanyMatch[]> {
  const term = query.trim();
  if (term.length < 3 || term.length > 100) return [];
  const numeric = /^[\d\s]+$/.test(term);
  const normalized = numeric ? term.replace(/\s/g, "") : term;
  if (numeric && !/^\d{8}$/.test(normalized)) return [];
  const apiKey = options.apiKey ?? process.env.AUTOFORM_API_KEY;
  if (!apiKey) throw new Error("Online register firiem ešte nie je pripojený. Môžete vybrať uloženého klienta alebo zadať údaje ručne.");
  const url = new URL("https://autoform.ekosystem.slovensko.digital/api/corporate_bodies/search");
  url.searchParams.set("q", `${numeric ? "cin" : "name"}:${normalized}`);
  url.searchParams.set("private_access_token", apiKey);
  url.searchParams.set("limit", "5");
  url.searchParams.set("filter", "active");
  try {
    const response = await (options.fetcher ?? fetch)(url, { signal: AbortSignal.timeout(6000), cache: "no-store", redirect: "error" });
    if (!response.ok) throw new Error("provider");
    return mapAutoformResults(await response.json());
  } catch {
    // A fetch error can contain the URL with the private token. Never return it.
    throw new Error("Online register firiem je dočasne nedostupný. Údaje môžete vyplniť ručne.");
  }
}
