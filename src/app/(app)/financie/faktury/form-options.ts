import { prisma } from "@/lib/prisma";

export interface IssuerOption { legalEntity: string | null; legalName: string; ico: string; dic: string; icDph: string | null; street: string; city: string; zip: string; country: string; validFrom: string; validTo: string | null }
export async function invoiceFormOptions() {
  const [clients, profiles] = await Promise.all([
    prisma.client.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true, ico: true, dic: true, icDph: true, street: true, city: true, zip: true, country: true } }),
    prisma.companyProfile.findMany({ where: { isActive: true }, orderBy: { validFrom: "desc" }, select: { legalEntity: true, legalName: true, ico: true, dic: true, icDph: true, street: true, city: true, zip: true, country: true, validFrom: true, validTo: true } }),
  ]);
  return { clients, issuers: profiles.map(p => ({ ...p, validFrom: p.validFrom.toISOString().slice(0, 10), validTo: p.validTo?.toISOString().slice(0, 10) ?? null })) };
}
