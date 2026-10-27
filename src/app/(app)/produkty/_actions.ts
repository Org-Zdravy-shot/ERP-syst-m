"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { parseEurToCents } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export interface ProductFormState { error?: string }

const productSchema = z.object({
  sku: z.string().trim().min(1, "Zadajte kód produktu.").max(80),
  name: z.string().trim().min(1, "Zadajte názov produktu.").max(200),
  volumeMl: z.number().int().positive().nullable(),
  priceB2cCents: z.number().int().nonnegative(),
  priceB2bCents: z.number().int().nonnegative().nullable(),
  vatRate: z.number().int().min(0).max(100),
  shelfLifeDays: z.number().int().positive().nullable(),
  shelfLifeConfirmed: z.boolean(),
  isActive: z.boolean(),
});

function positiveInteger(value: string, label: string, optional = false): number | null {
  if (optional && !value) return null;
  if (!/^\d+$/.test(value) || !Number.isInteger(Number(value)) || Number(value) <= 0 || Number(value) > 2_147_483_647) {
    throw new Error(`${label} musí byť kladné celé číslo.`);
  }
  return Number(value);
}

function money(value: string, label: string, optional = false): number | null {
  if (optional && !value) return null;
  try {
    const cents = parseEurToCents(value);
    if (cents < 0 || cents > 2_147_483_647) throw new Error();
    return cents;
  } catch {
    throw new Error(`${label} musí byť nezáporná suma v eurách.`);
  }
}

function parseProduct(formData: FormData) {
  try {
    const vatRaw = String(formData.get("vatRate") ?? "").trim();
    if (!/^\d+$/.test(vatRaw) || Number(vatRaw) > 100) throw new Error("DPH musí byť celé číslo od 0 do 100.");
    const parsed = productSchema.safeParse({
      sku: String(formData.get("sku") ?? ""),
      name: String(formData.get("name") ?? ""),
      volumeMl: positiveInteger(String(formData.get("volumeMl") ?? "").trim(), "Objem", true),
      priceB2cCents: money(String(formData.get("priceB2c") ?? "").trim(), "Predajná cena"),
      priceB2bCents: money(String(formData.get("priceB2b") ?? "").trim(), "Predvolená B2B cena", true),
      vatRate: Number(vatRaw),
      shelfLifeDays: positiveInteger(String(formData.get("shelfLifeDays") ?? "").trim(), "Trvanlivosť", true),
      shelfLifeConfirmed: formData.get("shelfLifeConfirmed") === "on",
      isActive: formData.get("isActive") === "on",
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatné údaje produktu." };
    return { data: parsed.data };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Neplatné údaje produktu." };
  }
}

function saveError(error: unknown): ProductFormState {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { error: "Produkt s týmto kódom už existuje. Zadajte iný kód." };
  }
  return { error: "Produkt sa nepodarilo uložiť. Skúste to znova." };
}

export async function createProduct(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  await requireUser();
  const parsed = parseProduct(formData);
  if (!parsed.data) return { error: parsed.error };
  let product: { id: string };
  try {
    const { shelfLifeConfirmed, ...data } = parsed.data;
    product = await prisma.product.create({ data: { ...data, shelfLifeConfirmedAt: shelfLifeConfirmed ? new Date() : null, unit: "ks" }, select: { id: true } });
  } catch (error) {
    return saveError(error);
  }
  revalidatePath("/produkty");
  revalidatePath("/objednavky/nova");
  revalidatePath("/objednavky/predplatne");
  if (formData.get("returnToOrder") === "1") {
    const params = new URLSearchParams({ produkt: product.id });
    const orderId = String(formData.get("returnOrderId") ?? "").trim();
    const klient = String(formData.get("returnKlient") ?? "").trim();
    const inbox = String(formData.get("returnInbox") ?? "").trim();
    if (klient && klient.length <= 100) params.set("klient", klient);
    if (inbox && inbox.length <= 100) params.set("inbox", inbox);
    redirect(orderId && /^[a-z0-9]{10,40}$/.test(orderId) ? `/objednavky/${orderId}/upravit?${params.toString()}` : `/objednavky/nova?${params.toString()}`);
  }
  redirect(`/produkty/${product.id}/upravit?ulozene=1`);
}

export async function updateProduct(id: string, _prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  await requireUser();
  const parsed = parseProduct(formData);
  if (!parsed.data) return { error: parsed.error };
  try {
    const { shelfLifeConfirmed, ...data } = parsed.data;
    const existing = shelfLifeConfirmed ? await prisma.product.findUnique({ where: { id }, select: { shelfLifeConfirmedAt: true } }) : null;
    await prisma.product.update({ where: { id }, data: { ...data, shelfLifeConfirmedAt: shelfLifeConfirmed ? existing?.shelfLifeConfirmedAt ?? new Date() : null } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { error: "Produkt už neexistuje." };
    }
    return saveError(error);
  }
  revalidatePath("/produkty");
  revalidatePath(`/produkty/${id}/upravit`);
  revalidatePath("/objednavky/nova");
  revalidatePath("/objednavky/predplatne");
  redirect(`/produkty/${id}/upravit?ulozene=1`);
}
