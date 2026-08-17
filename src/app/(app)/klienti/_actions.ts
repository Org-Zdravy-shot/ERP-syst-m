"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { parseEurToCents } from "@/lib/format";
import { clientSchema } from "@/lib/zod-schemas";

export interface ClientFormState {
  error?: string;
}

export interface ClientProductPriceFormState {
  error?: string;
  success?: string;
}

function parseClientForm(formData: FormData) {
  const raw = {
    type: String(formData.get("type") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
    ico: String(formData.get("ico") ?? "").trim() || undefined,
    dic: String(formData.get("dic") ?? "").trim() || undefined,
    icDph: String(formData.get("icDph") ?? "").trim() || undefined,
    email: String(formData.get("email") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim() || undefined,
    iban: String(formData.get("iban") ?? "").trim() || undefined,
    street: String(formData.get("street") ?? "").trim() || undefined,
    city: String(formData.get("city") ?? "").trim() || undefined,
    zip: String(formData.get("zip") ?? "").trim() || undefined,
    note: String(formData.get("note") ?? "").trim() || undefined,
  };
  return clientSchema.safeParse(raw);
}

function toDbData(data: z.infer<typeof clientSchema>, includeIban: boolean) {
  return {
    type: data.type,
    name: data.name,
    ico: data.ico ?? null,
    dic: data.dic ?? null,
    icDph: data.icDph ?? null,
    email: data.email || null,
    phone: data.phone ?? null,
    ...(includeIban ? { iban: data.iban ?? null } : {}),
    street: data.street ?? null,
    city: data.city ?? null,
    zip: data.zip ?? null,
    note: data.note ?? null,
  };
}

export async function createClient(_prevState: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const parsed = parseClientForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Neplatné údaje." };
  }
  const user = await requireUser();
  const canEditFinance = hasFinancePermission(user.role, "CONFIGURE");
  if (parsed.data.iban && !canEditFinance) {
    return { error: "IBAN klienta môže meniť iba finančný administrátor." };
  }

  const client = await prisma.client.create({ data: toDbData(parsed.data, canEditFinance) });

  revalidatePath("/klienti");
  redirect(`/klienti/${client.id}`);
}

export async function updateClient(clientId: string, _prevState: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const parsed = parseClientForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Neplatné údaje." };
  }
  const user = await requireUser();
  const canEditFinance = hasFinancePermission(user.role, "CONFIGURE");
  if (parsed.data.iban && !canEditFinance) {
    return { error: "IBAN klienta môže meniť iba finančný administrátor." };
  }

  const existing = await prisma.client.findUnique({ where: { id: clientId } });
  if (!existing) return { error: "Klient neexistuje." };

  await prisma.client.update({
    where: { id: clientId },
    data: toDbData(parsed.data, canEditFinance),
  });

  revalidatePath("/klienti");
  revalidatePath(`/klienti/${clientId}`);
  redirect(`/klienti/${clientId}`);
}

export async function toggleClientActive(clientId: string): Promise<void> {
  await requireUser();
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return;
  await prisma.client.update({ where: { id: clientId }, data: { isActive: !client.isActive } });
  revalidatePath("/klienti");
  revalidatePath(`/klienti/${clientId}`);
}

export async function saveClientProductPrices(
  clientId: string,
  _prevState: ClientProductPriceFormState,
  formData: FormData,
): Promise<ClientProductPriceFormState> {
  const user = await requireUser();
  if (!hasFinancePermission(user.role, "CONFIGURE")) {
    return { error: "Cenník klienta môže meniť iba finančný administrátor." };
  }

  const [client, products] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true, type: true } }),
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  if (!client) return { error: "Klient neexistuje." };
  if (client.type !== "B2B") return { error: "Individuálny cenník možno nastaviť iba B2B klientovi." };

  const prices: Array<{ productId: string; productName: string; unitPriceCents: number | null }> = [];
  for (const product of products) {
    const raw = String(formData.get(`price:${product.id}`) ?? "").trim();
    if (!raw) {
      prices.push({ productId: product.id, productName: product.name, unitPriceCents: null });
      continue;
    }
    try {
      const unitPriceCents = parseEurToCents(raw);
      if (unitPriceCents < 0 || unitPriceCents > 100_000_000) throw new Error("Cena je mimo povoleného rozsahu.");
      prices.push({ productId: product.id, productName: product.name, unitPriceCents });
    } catch {
      return { error: `Produkt ${product.name} má neplatnú B2B cenu.` };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const price of prices) {
        if (price.unitPriceCents === null) {
          await tx.clientProductPrice.deleteMany({
            where: { clientId, productId: price.productId },
          });
        } else {
          await tx.clientProductPrice.upsert({
            where: { clientId_productId: { clientId, productId: price.productId } },
            create: { clientId, productId: price.productId, unitPriceCents: price.unitPriceCents },
            update: { unitPriceCents: price.unitPriceCents },
          });
        }
      }
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "CLIENT_PRODUCT_PRICES_SAVED",
          entityType: "Client",
          entityId: clientId,
          afterData: prices.map((price) => ({
            productId: price.productId,
            unitPriceCents: price.unitPriceCents,
          })),
        },
      });
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "B2B cenník sa nepodarilo uložiť." };
  }

  revalidatePath(`/klienti/${clientId}`);
  revalidatePath("/objednavky");
  return { success: "Individuálny B2B cenník bol uložený." };
}
