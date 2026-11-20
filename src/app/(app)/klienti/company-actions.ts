"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { lookupAutoform, type CompanyMatch } from "@/lib/company-lookup";
import { findClientByIcoForCreation } from "./client-identity";

// Bounded process-local cache limits repeated paid requests while typing/backtracking.
// Authentication and the local database query still run on every request.
const registryCache = new Map<string, { expires: number; companies: CompanyMatch[] }>();

export async function searchCompanies(query: string): Promise<{ companies: CompanyMatch[]; notice?: string }> {
  await requireUser();
  const parsed = z.string().trim().min(3).max(100).safeParse(query);
  if (!parsed.success) return { companies: [] };
  const term = parsed.data;
  const local = await prisma.client.findMany({
    where: { isActive: true, OR: [{ name: { contains: term, mode: "insensitive" } }, { ico: { contains: term.replace(/\s/g, "") } }] },
    take: 8, orderBy: { name: "asc" },
    select: { id: true, name: true, ico: true, dic: true, icDph: true, street: true, city: true, zip: true, country: true },
  });
  const companies: CompanyMatch[] = local.map((row) => ({
    id: row.id, clientId: row.id, name: row.name, ico: row.ico ?? "", dic: row.dic ?? "", icDph: row.icDph ?? "",
    street: row.street ?? "", city: row.city ?? "", zip: row.zip ?? "", country: row.country, source: "ERP",
  }));
  try {
    const cacheKey = term.toLocaleLowerCase("sk").replace(/\s+/g, " ");
    const cached = registryCache.get(cacheKey);
    const remote = cached && cached.expires > Date.now() ? cached.companies : await lookupAutoform(term);
    if (!cached || cached.expires <= Date.now()) {
      if (registryCache.size >= 100) registryCache.delete(registryCache.keys().next().value!);
      registryCache.set(cacheKey, { companies: remote, expires: Date.now() + 5 * 60_000 });
    }
    const known = new Set(companies.map((row) => row.ico.replace(/\s/g, "")).filter(Boolean));
    return { companies: [...companies, ...remote.filter((row) => !known.has(row.ico))] };
  } catch (error) {
    return { companies, notice: error instanceof Error ? error.message : "Register firiem je nedostupný." };
  }
}

const inlineClientSchema = z.object({
  name: z.string().trim().min(1, "Zadajte názov firmy").max(255),
  ico: z.string().transform((v) => v.replace(/\s/g, "")).refine((v) => /^\d{8}$/.test(v), "IČO musí mať 8 číslic"),
  dic: z.string().trim().regex(/^$|^\d{10}$/, "DIČ musí mať 10 číslic"),
  icDph: z.string().trim().toUpperCase().regex(/^$|^SK\d{10}$/, "IČ DPH musí mať formát SK a 10 číslic"),
  street: z.string().trim().max(255), city: z.string().trim().max(120), zip: z.string().trim().max(20),
  country: z.literal("SK"),
});

export async function saveInvoiceClient(input: unknown): Promise<{ client?: { id: string; name: string; type: string }; error?: string }> {
  const user = await requireFinancePermission("CREATE_DRAFT");
  const parsed = inlineClientSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Skontrolujte údaje firmy." };
  const data = parsed.data;
  const client = await prisma.$transaction(async (tx) => {
    // Existing contacts are selected, never silently overwritten with registry data.
    const existing = await findClientByIcoForCreation(tx, data.ico);
    if (existing) {
      if (!existing.isActive) throw new Error("Firma s týmto IČO je archivovaná. Najprv ju obnovte v klientoch.");
      return { id: existing.id, name: existing.name, type: existing.type };
    }
    const created = await tx.client.create({ data: { ...data, type: "B2B", dic: data.dic || null, icDph: data.icDph || null }, select: { id: true, name: true, type: true } });
    await tx.auditLog.create({ data: { actorId: user.userId, action: "CLIENT_CREATED_FROM_INVOICE", entityType: "Client", entityId: created.id } });
    return created;
  }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "Klienta sa nepodarilo uložiť." }));
  if ("error" in client) return client;
  revalidatePath("/klienti");
  return { client };
}
