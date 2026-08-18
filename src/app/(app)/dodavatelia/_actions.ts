"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { prisma } from "@/lib/prisma";
import {
  supplierBankAccountSchema,
  supplierContactSchema,
  supplierLocationSchema,
  supplierSchema,
} from "@/lib/zod-schemas";

export interface SupplierFormState {
  error?: string;
}

export interface SupplierInlineFormState {
  error?: string;
  success?: string;
}

function optionalText(formData: FormData, key: string): string | undefined {
  return String(formData.get(key) ?? "").trim() || undefined;
}

function optionalNumber(formData: FormData, key: string): number | undefined {
  const value = String(formData.get(key) ?? "").trim().replace(",", ".");
  if (!value) return undefined;
  return Number(value);
}

function parseTags(formData: FormData): string[] {
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((tag) => tag.trim().toLocaleLowerCase("sk"))
    .filter(Boolean);
  return [...new Set(tags)].slice(0, 20).filter((tag) => tag.length <= 50);
}

function parseSupplier(formData: FormData) {
  return supplierSchema.safeParse({
    kind: String(formData.get("kind") ?? ""),
    name: String(formData.get("name") ?? ""),
    legalName: optionalText(formData, "legalName"),
    ico: optionalText(formData, "ico"),
    dic: optionalText(formData, "dic"),
    icDph: optionalText(formData, "icDph"),
    email: optionalText(formData, "email") ?? "",
    phone: optionalText(formData, "phone"),
    website: optionalText(formData, "website") ?? "",
    paymentTermsDays: Number(String(formData.get("paymentTermsDays") ?? "14")),
    currency: "EUR",
    source: String(formData.get("source") ?? "OTHER"),
    sourceDetail: optionalText(formData, "sourceDetail"),
    rating: optionalNumber(formData, "rating"),
    note: optionalText(formData, "note"),
  });
}

function supplierDbData(data: ReturnType<typeof parseSupplier>["data"]) {
  if (!data) throw new Error("Neplatné údaje dodávateľa.");
  return {
    kind: data.kind,
    name: data.name,
    legalName: data.legalName ?? null,
    ico: data.ico ?? null,
    dic: data.dic ?? null,
    icDph: data.icDph ?? null,
    email: data.email || null,
    phone: data.phone ?? null,
    website: data.website || null,
    paymentTermsDays: data.paymentTermsDays,
    currency: data.currency,
    source: data.source,
    sourceDetail: data.sourceDetail ?? null,
    rating: data.rating ?? null,
    note: data.note ?? null,
  };
}

function uniqueError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return "Dodávateľ s týmto IČO alebo rovnakým unikátnym údajom už existuje.";
  }
  return "Údaje sa nepodarilo uložiť.";
}

function revalidateSupplier(supplierId: string): void {
  revalidatePath("/dodavatelia");
  revalidatePath(`/dodavatelia/${supplierId}`);
}

export async function createSupplier(
  _previous: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const parsed = parseSupplier(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatné údaje." };
  const user = await requireUser();
  const tags = parseTags(formData);
  let supplierId: string;
  try {
    supplierId = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({ data: supplierDbData(parsed.data) });
      if (tags.length > 0) {
        await tx.supplierTag.createMany({ data: tags.map((name) => ({ supplierId: supplier.id, name })) });
      }
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "SUPPLIER_CREATED",
          entityType: "Supplier",
          entityId: supplier.id,
          afterData: { name: supplier.name, kind: supplier.kind, source: supplier.source, tags },
        },
      });
      return supplier.id;
    });
  } catch (error) {
    return { error: uniqueError(error) };
  }
  revalidatePath("/dodavatelia");
  redirect(`/dodavatelia/${supplierId}`);
}

export async function updateSupplier(
  supplierId: string,
  _previous: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const parsed = parseSupplier(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatné údaje." };
  const user = await requireUser();
  const tags = parseTags(formData);
  const existing = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, name: true, kind: true, source: true },
  });
  if (!existing) return { error: "Dodávateľ neexistuje." };
  try {
    await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.update({ where: { id: supplierId }, data: supplierDbData(parsed.data) });
      await tx.supplierTag.deleteMany({ where: { supplierId, name: { notIn: tags } } });
      if (tags.length > 0) {
        await tx.supplierTag.createMany({
          data: tags.map((name) => ({ supplierId, name })),
          skipDuplicates: true,
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "SUPPLIER_UPDATED",
          entityType: "Supplier",
          entityId: supplierId,
          beforeData: existing,
          afterData: { name: supplier.name, kind: supplier.kind, source: supplier.source, tags },
        },
      });
    });
  } catch (error) {
    return { error: uniqueError(error) };
  }
  revalidateSupplier(supplierId);
  redirect(`/dodavatelia/${supplierId}`);
}

export async function toggleSupplierActive(supplierId: string): Promise<void> {
  const user = await requireUser();
  const existing = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { isActive: true } });
  if (!existing) return;
  await prisma.$transaction([
    prisma.supplier.update({ where: { id: supplierId }, data: { isActive: !existing.isActive } }),
    prisma.auditLog.create({
      data: {
        actorId: user.userId,
        actorEmail: user.email,
        action: existing.isActive ? "SUPPLIER_DEACTIVATED" : "SUPPLIER_ACTIVATED",
        entityType: "Supplier",
        entityId: supplierId,
        beforeData: { isActive: existing.isActive },
        afterData: { isActive: !existing.isActive },
      },
    }),
  ]);
  revalidateSupplier(supplierId);
}

export async function createSupplierContact(
  supplierId: string,
  _previous: SupplierInlineFormState,
  formData: FormData,
): Promise<SupplierInlineFormState> {
  const parsed = supplierContactSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    role: optionalText(formData, "role"),
    email: optionalText(formData, "email") ?? "",
    phone: optionalText(formData, "phone"),
    isPrimary: formData.get("isPrimary") === "on",
    note: optionalText(formData, "note"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatný kontakt." };
  const user = await requireUser();
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
  if (!supplier) return { error: "Dodávateľ neexistuje." };
  await prisma.$transaction(async (tx) => {
    if (parsed.data.isPrimary) {
      await tx.supplierContact.updateMany({ where: { supplierId }, data: { isPrimary: false } });
    }
    const contact = await tx.supplierContact.create({
      data: {
        supplierId,
        name: parsed.data.name,
        role: parsed.data.role ?? null,
        email: parsed.data.email || null,
        phone: parsed.data.phone ?? null,
        isPrimary: parsed.data.isPrimary,
        note: parsed.data.note ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: user.userId,
        actorEmail: user.email,
        action: "SUPPLIER_CONTACT_CREATED",
        entityType: "SupplierContact",
        entityId: contact.id,
        metadata: { supplierId },
        afterData: { name: contact.name, role: contact.role, isPrimary: contact.isPrimary },
      },
    });
  });
  revalidateSupplier(supplierId);
  return { success: "Kontakt bol pridaný." };
}

export async function deleteSupplierContact(supplierId: string, contactId: string): Promise<void> {
  const user = await requireUser();
  const contact = await prisma.supplierContact.findFirst({ where: { id: contactId, supplierId } });
  if (!contact) return;
  await prisma.$transaction([
    prisma.supplierContact.delete({ where: { id: contact.id } }),
    prisma.auditLog.create({
      data: {
        actorId: user.userId,
        actorEmail: user.email,
        action: "SUPPLIER_CONTACT_REMOVED",
        entityType: "SupplierContact",
        entityId: contact.id,
        metadata: { supplierId },
        beforeData: { name: contact.name, role: contact.role, isPrimary: contact.isPrimary },
      },
    }),
  ]);
  revalidateSupplier(supplierId);
}

export async function createSupplierLocation(
  supplierId: string,
  _previous: SupplierInlineFormState,
  formData: FormData,
): Promise<SupplierInlineFormState> {
  const parsed = supplierLocationSchema.safeParse({
    type: String(formData.get("type") ?? "OTHER"),
    name: String(formData.get("name") ?? ""),
    street: optionalText(formData, "street"),
    city: optionalText(formData, "city"),
    zip: optionalText(formData, "zip"),
    country: optionalText(formData, "country") ?? "SK",
    latitude: optionalNumber(formData, "latitude"),
    longitude: optionalNumber(formData, "longitude"),
    openingHours: optionalText(formData, "openingHours"),
    deliveryInstructions: optionalText(formData, "deliveryInstructions"),
    isPrimary: formData.get("isPrimary") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatné miesto." };
  const user = await requireUser();
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
  if (!supplier) return { error: "Dodávateľ neexistuje." };
  await prisma.$transaction(async (tx) => {
    if (parsed.data.isPrimary) {
      await tx.supplierLocation.updateMany({ where: { supplierId }, data: { isPrimary: false } });
    }
    const location = await tx.supplierLocation.create({
      data: {
        supplierId,
        type: parsed.data.type,
        name: parsed.data.name,
        street: parsed.data.street ?? null,
        city: parsed.data.city ?? null,
        zip: parsed.data.zip ?? null,
        country: parsed.data.country,
        latitude: parsed.data.latitude ?? null,
        longitude: parsed.data.longitude ?? null,
        openingHours: parsed.data.openingHours ?? null,
        deliveryInstructions: parsed.data.deliveryInstructions ?? null,
        isPrimary: parsed.data.isPrimary,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: user.userId,
        actorEmail: user.email,
        action: "SUPPLIER_LOCATION_CREATED",
        entityType: "SupplierLocation",
        entityId: location.id,
        metadata: { supplierId },
        afterData: { name: location.name, type: location.type, city: location.city },
      },
    });
  });
  revalidateSupplier(supplierId);
  return { success: "Miesto bolo pridané." };
}

export async function deleteSupplierLocation(supplierId: string, locationId: string): Promise<void> {
  const user = await requireUser();
  const location = await prisma.supplierLocation.findFirst({ where: { id: locationId, supplierId } });
  if (!location) return;
  await prisma.$transaction([
    prisma.supplierLocation.delete({ where: { id: location.id } }),
    prisma.auditLog.create({
      data: {
        actorId: user.userId,
        actorEmail: user.email,
        action: "SUPPLIER_LOCATION_REMOVED",
        entityType: "SupplierLocation",
        entityId: location.id,
        metadata: { supplierId },
        beforeData: { name: location.name, type: location.type, city: location.city },
      },
    }),
  ]);
  revalidateSupplier(supplierId);
}

export async function createSupplierBankAccount(
  supplierId: string,
  _previous: SupplierInlineFormState,
  formData: FormData,
): Promise<SupplierInlineFormState> {
  const user = await requireUser();
  if (!hasFinancePermission(user.role, "CONFIGURE")) {
    return { error: "Bankové účty môže meniť iba finančný administrátor." };
  }
  const parsed = supplierBankAccountSchema.safeParse({
    name: optionalText(formData, "name"),
    iban: String(formData.get("iban") ?? ""),
    bic: optionalText(formData, "bic"),
    currency: "EUR",
    isPrimary: formData.get("isPrimary") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatný bankový účet." };
  try {
    await prisma.$transaction(async (tx) => {
      if (parsed.data.isPrimary) {
        await tx.supplierBankAccount.updateMany({ where: { supplierId }, data: { isPrimary: false } });
      }
      const account = await tx.supplierBankAccount.create({
        data: {
          supplierId,
          name: parsed.data.name ?? null,
          iban: parsed.data.iban,
          bic: parsed.data.bic ?? null,
          currency: parsed.data.currency,
          isPrimary: parsed.data.isPrimary,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "SUPPLIER_BANK_ACCOUNT_CREATED",
          entityType: "SupplierBankAccount",
          entityId: account.id,
          metadata: { supplierId },
          afterData: { ibanSuffix: account.iban.slice(-4), isPrimary: account.isPrimary },
        },
      });
    });
  } catch (error) {
    return { error: uniqueError(error) };
  }
  revalidateSupplier(supplierId);
  return { success: "Bankový účet bol pridaný." };
}

export async function deactivateSupplierBankAccount(supplierId: string, accountId: string): Promise<void> {
  const user = await requireUser();
  if (!hasFinancePermission(user.role, "CONFIGURE")) throw new Error("Nemáte oprávnenie meniť bankové účty.");
  const account = await prisma.supplierBankAccount.findFirst({ where: { id: accountId, supplierId } });
  if (!account) return;
  await prisma.$transaction([
    prisma.supplierBankAccount.update({ where: { id: account.id }, data: { isActive: false, isPrimary: false } }),
    prisma.auditLog.create({
      data: {
        actorId: user.userId,
        actorEmail: user.email,
        action: "SUPPLIER_BANK_ACCOUNT_DEACTIVATED",
        entityType: "SupplierBankAccount",
        entityId: account.id,
        metadata: { supplierId, ibanSuffix: account.iban.slice(-4) },
      },
    }),
  ]);
  revalidateSupplier(supplierId);
}
