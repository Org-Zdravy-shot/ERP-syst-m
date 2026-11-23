import { prisma } from "@/lib/prisma";

interface Validity { validFrom: string; validTo: string | null }
function asDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function validity(row: { validFrom: Date; validTo: Date | null }): Validity {
  return { validFrom: asDate(row.validFrom), validTo: row.validTo ? asDate(row.validTo) : null };
}

export interface IssuerOption extends Validity {
  legalEntity: string | null;
  legalName: string;
  ico: string;
  dic: string;
  icDph: string | null;
  street: string;
  city: string;
  zip: string;
  country: string;
  eurAccount: boolean;
  taxProfiles: (Validity & { vatStatus: string; vatRegisteredFrom: string | null })[];
}

export interface InvoiceProductOption {
  id: string;
  sku: string;
  name: string;
  unit: string;
  vatRates: (Validity & { rate: number; confirmed: boolean })[];
}

export async function invoiceFormOptions() {
  const [clients, profiles, products] = await Promise.all([
    prisma.client.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true, ico: true, dic: true, icDph: true, street: true, city: true, zip: true, country: true } }),
    prisma.companyProfile.findMany({
      where: { isActive: true },
      orderBy: { validFrom: "desc" },
      select: {
        legalEntity: true, legalName: true, ico: true, dic: true, icDph: true, street: true, city: true, zip: true, country: true, validFrom: true, validTo: true,
        taxProfiles: {
          select: { vatStatus: true, vatRegisteredFrom: true, validFrom: true, validTo: true },
          orderBy: { validFrom: "desc" },
        },
        bankAccounts: { where: { isActive: true, isPrimary: true, currency: "EUR" }, select: { id: true }, take: 1 },
      },
    }),
    prisma.product.findMany({
      where: { isActive: true }, orderBy: { name: "asc" },
      select: {
        id: true, sku: true, name: true, unit: true,
        vatRates: { select: { rate: true, confirmedAt: true, validFrom: true, validTo: true }, orderBy: { validFrom: "desc" } },
      },
    }),
  ]);
  const issuers: IssuerOption[] = profiles.map(({ taxProfiles, bankAccounts, ...profile }) => ({
    ...profile, ...validity(profile), eurAccount: bankAccounts.length > 0,
    taxProfiles: taxProfiles.map(tax => ({
      ...validity(tax), vatStatus: tax.vatStatus, vatRegisteredFrom: tax.vatRegisteredFrom ? asDate(tax.vatRegisteredFrom) : null,
    })),
  }));
  const catalog: InvoiceProductOption[] = products.map(({ vatRates, ...product }) => ({
    ...product, vatRates: vatRates.map(rate => ({ ...validity(rate), rate: rate.rate, confirmed: !!rate.confirmedAt })),
  }));
  return { clients, issuers, catalog };
}
