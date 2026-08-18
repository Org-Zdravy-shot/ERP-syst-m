"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBratislavaDateTime } from "@/lib/datetime";
import { invoiceDirectionSchema, vatStatusSchema } from "@/lib/zod-schemas";
import { invoiceService } from "@/lib/finance/invoice-service";
import { requireFinancePermission } from "@/lib/finance/permissions";

export interface InvoiceFormState {
  error?: string;
  success?: string;
}

// ---------- Koncept faktúry z objednávky ----------

export async function issueInvoiceFromOrder(
  orderId: string,
  _prev: InvoiceFormState,
  _formData: FormData,
): Promise<InvoiceFormState> {
  const user = await requireFinancePermission("CREATE_DRAFT");

  let invoiceId = "";
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { client: true, items: { include: { product: true } } },
    });
    if (!order) throw new Error("Objednávka neexistuje.");
    if (order.status === "ZRUSENA") throw new Error("Zo zrušenej objednávky nemožno vytvoriť faktúru.");
    if (order.items.length === 0) throw new Error("Objednávka nemá položky.");

    const now = new Date();
    const created = await invoiceService.createDraft({
      direction: "VYDANA",
      source: "INTERNA",
      clientId: order.clientId,
      orderId: order.id,
      issueDate: now,
      dueDate: new Date(now.getTime() + 14 * 24 * 3600 * 1000),
      deliveryDate: order.deliveryDate ?? undefined,
      currency: "EUR",
      items: order.items.map((item) => ({
        productId: item.productId,
        productSku: item.product.sku,
        description: `${item.product.name} (${item.product.sku})`,
        quantity: item.quantity,
        unit: item.product.unit,
        unitPriceCents: item.unitPriceCents,
        vatRate: item.vatRate,
      })),
      actorId: user.userId,
    });
    invoiceId = created.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Koncept faktúry sa nepodarilo vytvoriť." };
  }

  revalidatePath("/financie");
  revalidatePath("/financie/faktury");
  revalidatePath(`/objednavky/${orderId}`);
  redirect(`/financie/faktury/${invoiceId}`);
}

// ---------- Ručná faktúra ----------

const invoiceItemSchema = z.object({
  description: z.string().trim().min(1, "Popis položky je povinný").max(500),
  quantity: z.number().positive("Množstvo musí byť kladné").max(1_000_000),
  unit: z.string().trim().min(1).max(20),
  unitPriceCents: z.number().int("Cena musí byť v centoch").min(0).max(100_000_000),
  vatRate: z.number().int().min(0).max(100),
});

const manualInvoiceSchema = z
  .object({
    direction: invoiceDirectionSchema,
    clientId: z.string().max(100).optional(),
    supplierName: z.string().max(255).optional(),
    externalNumber: z.string().max(100).optional(),
    issueDate: z.date(),
    dueDate: z.date(),
    deliveryDate: z.date().optional(),
    variableSymbol: z.string().max(30).optional(),
    note: z.string().max(2_000).optional(),
    items: z.array(invoiceItemSchema).min(1, "Pridajte aspoň jednu položku").max(200),
  })
  .refine((d) => (d.direction === "VYDANA" ? !!d.clientId : true), {
    message: "Pri vydanej faktúre vyberte klienta.",
  })
  .refine((d) => (d.direction === "PRIJATA" ? !!d.supplierName || !!d.clientId : true), {
    message: "Pri prijatej faktúre zadajte dodávateľa.",
  });

export async function createManualInvoice(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const user = await requireFinancePermission("CREATE_DRAFT");

  let items: unknown;
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "Neplatné položky faktúry." };
  }

  const dateOf = (name: string) => {
    const raw = String(formData.get(name) ?? "").trim();
    return raw ? new Date(raw) : undefined;
  };

  const parsed = manualInvoiceSchema.safeParse({
    direction: String(formData.get("direction") ?? ""),
    clientId: String(formData.get("clientId") ?? "").trim() || undefined,
    supplierName: String(formData.get("supplierName") ?? "").trim() || undefined,
    externalNumber: String(formData.get("externalNumber") ?? "").trim() || undefined,
    issueDate: dateOf("issueDate") ?? new Date(),
    dueDate: dateOf("dueDate") ?? new Date(Date.now() + 14 * 24 * 3600 * 1000),
    deliveryDate: dateOf("deliveryDate"),
    variableSymbol: String(formData.get("variableSymbol") ?? "").trim() || undefined,
    note: String(formData.get("note") ?? "").trim() || undefined,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatné údaje." };

  const data = parsed.data;
  let invoiceId: string;
  try {
    const created = await invoiceService.createDraft({
      direction: data.direction,
      source: "INTERNA",
      externalNumber: data.externalNumber,
      clientId: data.clientId,
      ...(data.direction === "PRIJATA" && data.supplierName
        ? { counterparty: { name: data.supplierName, country: "SK" } }
        : {}),
      issueDate: data.issueDate,
      dueDate: data.dueDate,
      deliveryDate: data.deliveryDate,
      currency: "EUR",
      variableSymbol: data.variableSymbol,
      note: data.note,
      items: data.items,
      actorId: user.userId,
    });
    invoiceId = created.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Koncept faktúry sa nepodarilo vytvoriť." };
  }

  revalidatePath("/financie");
  revalidatePath("/financie/faktury");
  redirect(`/financie/faktury/${invoiceId}`);
}

// ---------- Finalizácia a storno ----------

export async function finalizeInvoice(
  invoiceId: string,
  _prev: InvoiceFormState,
  _formData: FormData,
): Promise<InvoiceFormState> {
  const user = await requireFinancePermission("FINALIZE");
  try {
    const invoice = await invoiceService.finalize(invoiceId, user.userId);
    revalidatePath("/financie");
    revalidatePath("/financie/faktury");
    revalidatePath(`/financie/faktury/${invoiceId}`);
    return { success: `Faktúra ${invoice.invoiceNumber} bola finalizovaná a čaká na vytvorenie PDF.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Faktúru sa nepodarilo finalizovať." };
  }
}

export async function cancelInvoice(
  invoiceId: string,
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const user = await requireFinancePermission("CANCEL");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Dôvod storna je povinný." };
  if (reason.length > 1_000) return { error: "Dôvod storna môže mať najviac 1 000 znakov." };

  try {
    await invoiceService.cancel(invoiceId, reason, user.userId);
    revalidatePath("/financie");
    revalidatePath("/financie/faktury");
    revalidatePath(`/financie/faktury/${invoiceId}`);
    return { success: "Doklad bol stornovaný. História a prílohy zostali zachované." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Doklad sa nepodarilo stornovať." };
  }
}

export async function createCreditNoteFromInvoice(
  invoiceId: string,
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const user = await requireFinancePermission("CREATE_DRAFT");
  const issueDate = formDate(formData, "issueDate");
  const dueDate = formDate(formData, "dueDate");
  const deliveryDate = formDate(formData, "deliveryDate");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!issueDate || !dueDate || !deliveryDate) return { error: "Vyplňte všetky dátumy dobropisu." };
  if (!reason) return { error: "Dôvod dobropisu je povinný." };
  if (reason.length > 1_000) return { error: "Dôvod dobropisu môže mať najviac 1 000 znakov." };

  let creditNoteId: string;
  try {
    const creditNote = await invoiceService.createCreditNote({
      originalInvoiceId: invoiceId,
      issueDate,
      dueDate,
      deliveryDate,
      reason,
      actorId: user.userId,
    });
    creditNoteId = creditNote.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Dobropis sa nepodarilo vytvoriť." };
  }

  revalidatePath("/financie");
  revalidatePath("/financie/faktury");
  revalidatePath(`/financie/faktury/${invoiceId}`);
  redirect(`/financie/faktury/${creditNoteId}`);
}

// ---------- eKasa import ----------

const ekasaRowSchema = z.object({
  saleDate: z.string().min(1).max(50),
  receiptNumber: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  productCode: z.string().max(100).optional(),
  ean: z.string().max(100).optional(),
  itemType: z.string().max(100).optional(),
  source: z.enum(["VRP2_XLSX", "CSV", "MANUAL"]).default("CSV"),
  quantity: z.number().finite().min(-1_000_000).max(1_000_000).refine((value) => value !== 0, "Množstvo nesmie byť nula").default(1),
  totalGrossCents: z.number().int().safe().min(-100_000_000).max(100_000_000),
  vatRate: z.number().int().min(0).max(100).nullable().optional(),
});

type EkasaRow = z.infer<typeof ekasaRowSchema>;

function normalizedKeyPart(value: string | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("sk");
}

function ekasaSourceKey(row: EkasaRow, saleDate: Date, occurrence: number): string {
  const signature = [
    normalizedKeyPart(row.receiptNumber),
    saleDate.toISOString(),
    normalizedKeyPart(row.productCode),
    normalizedKeyPart(row.ean),
    normalizedKeyPart(row.description),
    normalizedKeyPart(row.itemType),
    row.quantity.toFixed(6),
    String(row.totalGrossCents),
    row.vatRate === null || row.vatRate === undefined ? "" : String(row.vatRate),
    String(occurrence),
  ].join("|");
  return createHash("sha256").update(signature).digest("hex");
}

async function saveEkasaRows(
  rows: EkasaRow[],
  importBatch: string,
  user: { userId: string; email: string },
): Promise<InvoiceFormState> {
  const products = await prisma.product.findMany({ select: { id: true, name: true, sku: true } });
  const productByName = new Map(products.map((product) => [normalizedKeyPart(product.name), product.id]));
  const productBySku = new Map(products.map((product) => [normalizedKeyPart(product.sku), product.id]));
  const occurrences = new Map<string, number>();
  let invalid = 0;

  const prepared = rows.flatMap((row) => {
    const saleDate = new Date(row.saleDate);
    if (Number.isNaN(saleDate.getTime())) {
      invalid += 1;
      return [];
    }

    const occurrenceSignature = [
      normalizedKeyPart(row.receiptNumber),
      saleDate.toISOString(),
      normalizedKeyPart(row.productCode),
      normalizedKeyPart(row.ean),
      normalizedKeyPart(row.description),
      normalizedKeyPart(row.itemType),
      row.quantity.toFixed(6),
      String(row.totalGrossCents),
      row.vatRate === null || row.vatRate === undefined ? "" : String(row.vatRate),
    ].join("|");
    const occurrence = occurrences.get(occurrenceSignature) ?? 0;
    occurrences.set(occurrenceSignature, occurrence + 1);

    return [{
      saleDate,
      receiptNumber: row.receiptNumber?.trim() || null,
      description: row.description?.trim() || null,
      productId:
        (row.productCode ? productBySku.get(normalizedKeyPart(row.productCode)) : undefined) ??
        (row.description ? productByName.get(normalizedKeyPart(row.description)) : undefined) ??
        null,
      productCode: row.productCode?.trim() || null,
      ean: row.ean?.trim() || null,
      itemType: row.itemType?.trim() || null,
      source: row.source,
      sourceKey: ekasaSourceKey(row, saleDate, occurrence),
      quantity: row.quantity,
      totalGrossCents: row.totalGrossCents,
      vatRate: row.vatRate ?? null,
      importBatch,
    }];
  });

  if (prepared.length === 0) return { error: "Import neobsahuje žiadne platné predaje." };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.ekasaSale.createMany({ data: prepared, skipDuplicates: true });
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: rows[0]?.source === "MANUAL" ? "EKASA_SALE_CREATED" : "EKASA_IMPORT_COMMITTED",
          entityType: "EkasaSale",
          entityId: importBatch,
          metadata: {
            source: rows[0]?.source ?? "CSV",
            inputRows: rows.length,
            createdRows: created.count,
            skippedRows: prepared.length - created.count,
            invalidRows: invalid,
          },
        },
      });
      return created;
    });

    revalidatePath("/financie");
    revalidatePath("/financie/ekasa");
    revalidatePath("/plan");
    revalidatePath("/");

    const skipped = prepared.length - result.count;
    const parts = [`Importované: ${result.count}`, `duplikáty: ${skipped}`];
    if (invalid > 0) parts.push(`chybné riadky: ${invalid}`);
    return result.count === 0 && skipped === 0
      ? { error: parts.join(" · ") }
      : { success: parts.join(" · ") };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Predaje sa nepodarilo uložiť.",
    };
  }
}

export async function importEkasaRows(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const user = await requireFinancePermission("CREATE_DRAFT");
  const importBatch = String(formData.get("importBatch") ?? "import").slice(0, 200);
  let rowsRaw: unknown;
  try {
    rowsRaw = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { error: "Neplatné dáta importu." };
  }

  const rows = z.array(ekasaRowSchema).max(2000, "Naraz možno importovať max 2000 riadkov.").safeParse(rowsRaw);
  if (!rows.success) return { error: rows.error.issues[0]?.message ?? "Neplatné riadky importu." };
  if (rows.data.length === 0) return { error: "Súbor neobsahuje žiadne predaje." };
  return saveEkasaRows(rows.data, importBatch, user);
}

export async function createManualEkasaSale(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const user = await requireFinancePermission("CREATE_DRAFT");
  const saleDate = parseBratislavaDateTime(String(formData.get("saleDate") ?? ""));
  if (!saleDate) return { error: "Zadajte platný dátum a čas predaja." };

  const grossValue = String(formData.get("totalGross") ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  const totalGross = Number(grossValue);
  const quantity = Number(String(formData.get("quantity") ?? "").replace(",", "."));
  const vatRaw = String(formData.get("vatRate") ?? "").trim();

  const parsed = ekasaRowSchema.safeParse({
    saleDate: saleDate.toISOString(),
    receiptNumber: String(formData.get("receiptNumber") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    productCode: String(formData.get("productCode") ?? "").trim() || undefined,
    itemType: String(formData.get("itemType") ?? "kladná").trim(),
    source: "MANUAL",
    quantity,
    totalGrossCents: Number.isFinite(totalGross) ? Math.round(totalGross * 100) : Number.NaN,
    vatRate: vatRaw ? Number(vatRaw) : null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Skontrolujte údaje predaja." };
  }

  if (!parsed.data.receiptNumber) return { error: "Identifikátor dokladu je povinný." };
  if (!parsed.data.description) return { error: "Popis položky je povinný." };
  if (parsed.data.totalGrossCents === 0) return { error: "Suma položky nesmie byť nula." };

  return saveEkasaRows(
    [parsed.data],
    `Manuálne · ${parsed.data.receiptNumber} · ${new Date().toISOString()}`,
    user,
  );
}

// ---------- Firemný profil a DPH nastavenia ----------

const financeProfileFormSchema = z
  .object({
    legalName: z.string().min(1, "Obchodné meno je povinné").max(255),
    tradeName: z.string().max(255).optional(),
    ico: z.string().min(1, "IČO je povinné").max(20),
    dic: z.string().min(1, "DIČ je povinné").max(20),
    icDph: z.string().max(20).optional(),
    email: z.string().email("Neplatný e-mail").max(320),
    phone: z.string().max(50).optional(),
    street: z.string().min(1, "Ulica je povinná").max(255),
    city: z.string().min(1, "Mesto je povinné").max(100),
    zip: z.string().min(1, "PSČ je povinné").max(20),
    validFrom: z.date(),
    vatStatus: vatStatusSchema,
    vatRegisteredFrom: z.date().optional(),
    accountantConfirmed: z.boolean(),
    accountantConfirmedBy: z.string().max(255).optional(),
    iban: z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, "Neplatný IBAN"),
    bic: z.string().max(20).optional(),
  })
  .refine((value) => value.vatStatus !== "PAYER" || !!value.vatRegisteredFrom, {
    message: "Platiteľ DPH musí mať dátum registrácie.",
    path: ["vatRegisteredFrom"],
  })
  .refine((value) => !value.accountantConfirmed || !!value.accountantConfirmedBy, {
    message: "Pri potvrdení zadajte meno účtovníka.",
    path: ["accountantConfirmedBy"],
  });

function formDate(formData: FormData, name: string): Date | undefined {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function saveFinanceProfile(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const user = await requireFinancePermission("CONFIGURE");
  const parsed = financeProfileFormSchema.safeParse({
    legalName: String(formData.get("legalName") ?? "").trim(),
    tradeName: String(formData.get("tradeName") ?? "").trim() || undefined,
    ico: String(formData.get("ico") ?? "").trim(),
    dic: String(formData.get("dic") ?? "").trim(),
    icDph: String(formData.get("icDph") ?? "").trim() || undefined,
    email: String(formData.get("email") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim() || undefined,
    street: String(formData.get("street") ?? "").trim(),
    city: String(formData.get("city") ?? "").trim(),
    zip: String(formData.get("zip") ?? "").trim(),
    validFrom: formDate(formData, "validFrom"),
    vatStatus: String(formData.get("vatStatus") ?? ""),
    vatRegisteredFrom: formDate(formData, "vatRegisteredFrom"),
    accountantConfirmed: formData.get("accountantConfirmed") === "on",
    accountantConfirmedBy: String(formData.get("accountantConfirmedBy") ?? "").trim() || undefined,
    iban: String(formData.get("iban") ?? "").replace(/\s/g, "").toUpperCase(),
    bic: String(formData.get("bic") ?? "").replace(/\s/g, "").toUpperCase() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Neplatné nastavenia." };

  const data = parsed.data;
  try {
    await prisma.$transaction(async (tx) => {
      const sameStart = await tx.companyProfile.findFirst({ where: { validFrom: data.validFrom } });
      if (sameStart) {
        throw new Error("Firemný profil s rovnakým začiatkom platnosti už existuje.");
      }
      const previousEnd = new Date(data.validFrom.getTime() - 1);
      const nextProfile = await tx.companyProfile.findFirst({
        where: { validFrom: { gt: data.validFrom } },
        orderBy: { validFrom: "asc" },
        select: { validFrom: true },
      });
      const validTo = nextProfile ? new Date(nextProfile.validFrom.getTime() - 1) : null;
      await tx.companyProfile.updateMany({
        where: {
          validFrom: { lt: data.validFrom },
          OR: [{ validTo: null }, { validTo: { gte: data.validFrom } }],
        },
        data: { validTo: previousEnd },
      });
      const profile = await tx.companyProfile.create({
        data: {
          legalName: data.legalName,
          tradeName: data.tradeName ?? null,
          ico: data.ico,
          dic: data.dic,
          icDph: data.icDph ?? null,
          email: data.email,
          phone: data.phone ?? null,
          street: data.street,
          city: data.city,
          zip: data.zip,
          country: "SK",
          validFrom: data.validFrom,
          validTo,
          taxProfiles: {
            create: {
              vatStatus: data.vatStatus,
              vatRegisteredFrom: data.vatStatus === "PAYER" ? data.vatRegisteredFrom : null,
              domesticTaxMode: "STANDARD",
              validFrom: data.validFrom,
              validTo,
              accountantConfirmedAt: data.accountantConfirmed ? new Date() : null,
              accountantConfirmedBy: data.accountantConfirmedBy ?? null,
            },
          },
        },
      });
      await tx.bankAccount.upsert({
        where: { iban_currency: { iban: data.iban, currency: "EUR" } },
        create: {
          companyProfileId: profile.id,
          name: "Hlavný účet",
          iban: data.iban,
          bic: data.bic ?? null,
          currency: "EUR",
          isPrimary: true,
        },
        update: {
          companyProfileId: profile.id,
          bic: data.bic ?? null,
          isPrimary: true,
          isActive: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "FINANCE_PROFILE_CREATED",
          entityType: "CompanyProfile",
          entityId: profile.id,
          afterData: {
            validFrom: data.validFrom.toISOString(),
            vatStatus: data.vatStatus,
            vatRegisteredFrom: data.vatRegisteredFrom?.toISOString(),
            accountantConfirmed: data.accountantConfirmed,
            iban: data.iban,
          },
        },
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Nastavenia sa nepodarilo uložiť." };
  }

  revalidatePath("/financie");
  revalidatePath("/financie/nastavenia");
  return { success: "Nová časovo platná verzia firemného a daňového profilu bola uložená." };
}

export async function saveProductVatRates(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const user = await requireFinancePermission("CONFIGURE");
  const validFrom = formDate(formData, "validFrom");
  if (!validFrom) return { error: "Začiatok platnosti sadzieb je povinný." };

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  const rates: Array<{ productId: string; name: string; rate: number; confirmed: boolean }> = [];
  for (const product of products) {
    const rate = Number.parseInt(String(formData.get(`rate:${product.id}`) ?? ""), 10);
    if (!Number.isInteger(rate) || rate < 0 || rate > 100) {
      return { error: `Produkt ${product.name} má neplatnú sadzbu DPH.` };
    }
    rates.push({
      productId: product.id,
      name: product.name,
      rate,
      confirmed: formData.get(`confirmed:${product.id}`) === "on",
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const previousEnd = new Date(validFrom.getTime() - 1);
      for (const rate of rates) {
        await tx.productVatRate.updateMany({
          where: {
            productId: rate.productId,
            validFrom: { lt: validFrom },
            OR: [{ validTo: null }, { validTo: { gte: validFrom } }],
          },
          data: { validTo: previousEnd },
        });
        await tx.productVatRate.upsert({
          where: { productId_validFrom: { productId: rate.productId, validFrom } },
          create: {
            productId: rate.productId,
            rate: rate.rate,
            validFrom,
            confirmedAt: rate.confirmed ? new Date() : null,
            confirmedBy: rate.confirmed ? user.email : null,
            sourceNote: "Nastavenie Financie v2",
          },
          update: {
            rate: rate.rate,
            confirmedAt: rate.confirmed ? new Date() : null,
            confirmedBy: rate.confirmed ? user.email : null,
          },
        });
        if (validFrom.getTime() <= Date.now()) {
          await tx.product.update({ where: { id: rate.productId }, data: { vatRate: rate.rate } });
        }
      }
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email,
          action: "PRODUCT_VAT_RATES_SAVED",
          entityType: "ProductVatRate",
          entityId: validFrom.toISOString(),
          afterData: rates,
        },
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sadzby DPH sa nepodarilo uložiť." };
  }

  revalidatePath("/financie/nastavenia");
  return {
    success: rates.every((rate) => rate.confirmed)
      ? "Sadzby DPH boli uložené a potvrdené."
      : "Sadzby boli uložené; nepotvrdené produkty budú blokovať finalizáciu.",
  };
}
