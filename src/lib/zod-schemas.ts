import { z } from "zod";

// Povolené hodnoty "enumov" — DB ich nevynucuje (SQLite), stráži ich táto vrstva.

export const unitSchema = z.enum(["ks", "kg", "l", "g", "ml"]);
export const clientTypeSchema = z.enum(["B2B", "B2C"]);
export const orderChannelSchema = z.enum(["MANUAL", "EMAIL", "WEB", "SUBSCRIPTION"]);
export const orderStatusSchema = z.enum(["NOVA", "POTVRDENA", "VO_VYROBE", "EXPEDOVANA", "DORUCENA", "ZRUSENA"]);
export const batchStatusSchema = z.enum(["PLANNED", "DONE", "CANCELLED"]);
export const movementTypeSchema = z.enum(["PRIJEM", "VYDAJ", "VYROBA", "SPOTREBA", "PREDAJ", "KOREKCIA"]);
export const invoiceDirectionSchema = z.enum(["VYDANA", "PRIJATA"]);
export const invoiceSourceSchema = z.enum(["INTERNA", "WEB", "SUPERFAKTURA", "OMEGA"]);
export const invoiceStatusSchema = z.enum(["VYSTAVENA", "UHRADENA", "PO_SPLATNOSTI", "STORNO"]);
export const invoiceDocumentTypeSchema = z.enum(["INVOICE", "CREDIT_NOTE"]);
export const invoiceDocumentStatusSchema = z.enum(["DRAFT", "ISSUED", "CANCELLED"]);
export const invoicePaymentStatusSchema = z.enum(["UNPAID", "PARTIALLY_PAID", "PAID", "OVERPAID"]);
export const financeRoleSchema = z.enum(["admin", "FINANCE_ADMIN", "FINANCE_OPERATOR"]);
export const currencySchema = z.literal("EUR");
export const vatStatusSchema = z.enum(["NON_PAYER", "PAYER"]);
export const domesticTaxModeSchema = z.enum(["STANDARD", "EXEMPT"]);
export const paymentDirectionSchema = z.enum(["INCOMING", "OUTGOING"]);
export const paymentSourceSchema = z.enum(["MANUAL", "BANK_IMPORT", "TATRA_PREMIUM"]);
export const bankProviderSchema = z.enum(["TATRA_PREMIUM", "STATEMENT_IMPORT"]);
export const bankConnectionStatusSchema = z.enum(["CONNECTED", "DISCONNECTED", "REAUTH_REQUIRED", "ERROR"]);
export const bankTransactionStatusSchema = z.enum(["PENDING", "BOOKED"]);
export const documentAssetTypeSchema = z.enum(["INVOICE_PDF", "CREDIT_NOTE_PDF", "ATTACHMENT"]);
export const outboxStatusSchema = z.enum(["PENDING", "PROCESSING", "DONE", "FAILED"]);
export const emailDeliveryStatusSchema = z.enum(["PENDING", "SENT", "DELIVERED", "FAILED", "BOUNCED"]);
export const importSourceSchema = z.enum(["OMEGA", "SUPERFAKTURA", "BANK_STATEMENT"]);
export const importModeSchema = z.enum(["DRY_RUN", "COMMIT"]);
export const importStatusSchema = z.enum(["PENDING", "VALIDATED", "COMMITTED", "FAILED"]);
export const subscriptionFrequencySchema = z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]);
export const inboxSourceSchema = z.enum(["EMAIL", "WEB_FORM", "MANUAL"]);
export const inboxStatusSchema = z.enum(["NOVA", "SPRACOVANA", "IGNOROVANA"]);
export const supplierKindSchema = z.enum(["COMPANY", "PERSON"]);
export const supplierSourceSchema = z.enum(["REFERRAL", "WEB", "FAIR", "MARKETPLACE", "EXISTING", "OTHER"]);
export const supplierLocationTypeSchema = z.enum(["REGISTERED", "WAREHOUSE", "PICKUP", "BILLING", "OTHER"]);
export const supplierPriceTypeSchema = z.enum(["NET", "GROSS"]);
export const supplierOrderStatusSchema = z.enum([
  "DRAFT",
  "APPROVED",
  "SENT",
  "CONFIRMED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
]);
export const supplierReturnableOwnerSchema = z.enum(["SUPPLIER", "COMPANY"]);
export const supplierAccountEntryTypeSchema = z.enum([
  "OPENING_BALANCE",
  "DEPOSIT",
  "CREDIT",
  "ADJUSTMENT",
  "OTHER",
]);

export const invoiceDocumentStatusLabels: Record<string, string> = {
  DRAFT: "Koncept",
  ISSUED: "Vystavená",
  CANCELLED: "Stornovaná",
};

export const invoicePaymentStatusLabels: Record<string, string> = {
  UNPAID: "Neuhradená",
  PARTIALLY_PAID: "Čiastočne uhradená",
  PAID: "Uhradená",
  OVERPAID: "Preplatok",
};

export const financeRoleLabels: Record<string, string> = {
  admin: "Administrátor",
  FINANCE_ADMIN: "Finančný administrátor",
  FINANCE_OPERATOR: "Finančný operátor",
};

export const bankConnectionStatusLabels: Record<string, string> = {
  CONNECTED: "Pripojené",
  DISCONNECTED: "Odpojené",
  REAUTH_REQUIRED: "Vyžaduje obnovenie prístupu",
  ERROR: "Chyba",
};

export const emailDeliveryStatusLabels: Record<string, string> = {
  PENDING: "Čaká na odoslanie",
  SENT: "Odoslané",
  DELIVERED: "Doručené",
  FAILED: "Odoslanie zlyhalo",
  BOUNCED: "Nedoručiteľné",
};

export const supplierKindLabels: Record<string, string> = {
  COMPANY: "Firma",
  PERSON: "Fyzická osoba",
};

export const supplierSourceLabels: Record<string, string> = {
  REFERRAL: "Odporúčanie",
  WEB: "Web",
  FAIR: "Veľtrh alebo podujatie",
  MARKETPLACE: "Trhovisko",
  EXISTING: "Existujúci kontakt",
  OTHER: "Iné",
};

export const supplierLocationTypeLabels: Record<string, string> = {
  REGISTERED: "Sídlo",
  WAREHOUSE: "Sklad",
  PICKUP: "Osobný odber",
  BILLING: "Fakturačná adresa",
  OTHER: "Iné miesto",
};

export const supplierOrderStatusLabels: Record<string, string> = {
  DRAFT: "Koncept",
  APPROVED: "Schválená",
  SENT: "Odoslaná",
  CONFIRMED: "Potvrdená",
  PARTIALLY_RECEIVED: "Čiastočne prijatá",
  RECEIVED: "Prijatá",
  CANCELLED: "Zrušená",
};

export const supplierReturnableOwnerLabels: Record<string, string> = {
  SUPPLIER: "Patrí dodávateľovi",
  COMPANY: "Patrí nám",
};

export const supplierAccountEntryTypeLabels: Record<string, string> = {
  OPENING_BALANCE: "Počiatočný stav",
  DEPOSIT: "Depozit",
  CREDIT: "Kredit alebo zápočet",
  ADJUSTMENT: "Korekcia",
  OTHER: "Iné",
};

const optionalShortText = z.string().trim().max(255).optional();
const optionalLongText = z.string().trim().max(5_000).optional();

export const supplierSchema = z.object({
  kind: supplierKindSchema,
  name: z.string().trim().min(1, "Názov dodávateľa je povinný").max(255),
  legalName: optionalShortText,
  ico: z.string().trim().max(20).optional(),
  dic: z.string().trim().max(20).optional(),
  icDph: z.string().trim().max(24).optional(),
  email: z.string().trim().email("Neplatný e-mail").max(320).optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
  website: z.string().trim().url("Neplatná webová adresa").max(2_048).optional().or(z.literal("")),
  paymentTermsDays: z.number().int().min(0).max(3650),
  currency: currencySchema,
  source: supplierSourceSchema,
  sourceDetail: optionalShortText,
  rating: z.number().int().min(1).max(5).optional(),
  note: optionalLongText,
});

export const supplierContactSchema = z.object({
  name: z.string().trim().min(1, "Meno kontaktu je povinné").max(255),
  role: optionalShortText,
  email: z.string().trim().email("Neplatný e-mail").max(320).optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
  isPrimary: z.boolean().default(false),
  note: optionalLongText,
});

export const supplierLocationSchema = z.object({
  type: supplierLocationTypeSchema,
  name: z.string().trim().min(1, "Názov miesta je povinný").max(255),
  street: optionalShortText,
  city: optionalShortText,
  zip: z.string().trim().max(20).optional(),
  country: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  openingHours: z.string().trim().max(1_000).optional(),
  deliveryInstructions: optionalLongText,
  isPrimary: z.boolean().default(false),
});

export const supplierBankAccountSchema = z.object({
  name: optionalShortText,
  iban: z
    .string()
    .transform((value) => value.replace(/\s+/g, "").toUpperCase())
    .refine((value) => /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value), "Neplatný formát IBAN"),
  bic: z.string().trim().max(20).optional(),
  currency: currencySchema,
  isPrimary: z.boolean().default(false),
});

export const supplierCatalogItemSchema = z
  .object({
    materialId: z.string().min(1).optional(),
    productId: z.string().min(1).optional(),
    supplierSku: optionalShortText,
    name: z.string().trim().min(1, "Názov ponuky je povinný").max(255),
    unit: unitSchema,
    packQuantity: z.number().positive().max(1_000_000),
    minOrderQuantity: z.number().nonnegative().max(1_000_000_000),
    orderMultiple: z.number().positive().max(1_000_000),
    leadTimeDays: z.number().int().min(0).max(3650),
    originCountry: z.string().trim().length(2).transform((value) => value.toUpperCase()).optional(),
    qualityNote: optionalLongText,
    note: optionalLongText,
    isPreferred: z.boolean().default(false),
  })
  .refine((data) => !(data.materialId && data.productId), {
    message: "Ponuka nemôže byť naraz priradená k surovine aj produktu.",
  });

export const supplierPriceSchema = z
  .object({
    unitPriceCents: z.number().int().nonnegative().max(100_000_000_000),
    pricePerQuantity: z.number().positive().max(1_000_000),
    minimumQuantity: z.number().nonnegative().max(1_000_000_000),
    currency: currencySchema,
    priceType: supplierPriceTypeSchema,
    vatRate: z.number().int().min(0).max(100).optional(),
    validFrom: z.date(),
    validTo: z.date().optional(),
    note: optionalLongText,
  })
  .refine((data) => !data.validTo || data.validTo >= data.validFrom, {
    message: "Koniec platnosti ceny nesmie byť pred jej začiatkom.",
    path: ["validTo"],
  });

export const supplierReturnableTypeSchema = z.object({
  name: z.string().trim().min(1, "Názov vratného obalu je povinný").max(255),
  unit: unitSchema,
  owner: supplierReturnableOwnerSchema,
  depositCents: z.number().int().nonnegative().max(100_000_000).optional(),
  expectedReturnDays: z.number().int().positive().max(3650).optional(),
  reminderNote: optionalLongText,
});

export const supplierReturnableMovementSchema = z.object({
  quantity: z.number().finite().refine((value) => value !== 0, "Množstvo nesmie byť nula."),
  occurredAt: z.date(),
  dueDate: z.date().optional(),
  reference: optionalShortText,
  note: optionalLongText,
});

export const supplierAccountEntrySchema = z.object({
  type: supplierAccountEntryTypeSchema,
  amountCents: z.number().int().safe().refine((value) => value !== 0, "Suma nesmie byť nula."),
  occurredAt: z.date(),
  dueDate: z.date().optional(),
  reference: optionalShortText,
  note: optionalLongText,
});

export const clientSchema = z.object({
  type: clientTypeSchema,
  name: z.string().min(1, "Meno je povinné"),
  ico: z.string().optional(),
  dic: z.string().optional(),
  icDph: z.string().optional(),
  email: z.string().email("Neplatný e-mail").optional().or(z.literal("")),
  phone: z.string().optional(),
  iban: z
    .string()
    .transform((value) => value.replace(/\s+/g, "").toUpperCase())
    .refine((value) => /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value), "Neplatný formát IBAN")
    .optional(),
  street: z.string().optional(),
  city: z.string().optional(),
  zip: z.string().optional(),
  note: z.string().optional(),
});

export const companyProfileSchema = z.object({
  legalName: z.string().min(1, "Obchodné meno je povinné"),
  tradeName: z.string().optional(),
  ico: z.string().min(1, "IČO je povinné"),
  dic: z.string().min(1, "DIČ je povinné"),
  icDph: z.string().optional(),
  email: z.string().email("Neplatný e-mail"),
  phone: z.string().optional(),
  street: z.string().min(1, "Ulica je povinná"),
  city: z.string().min(1, "Mesto je povinné"),
  zip: z.string().min(1, "PSČ je povinné"),
  country: z.string().length(2).default("SK"),
  validFrom: z.date(),
  validTo: z.date().optional(),
});

export const taxProfileSchema = z
  .object({
    companyProfileId: z.string().min(1),
    vatStatus: vatStatusSchema,
    vatRegisteredFrom: z.date().optional(),
    domesticTaxMode: domesticTaxModeSchema,
    validFrom: z.date(),
    validTo: z.date().optional(),
    accountantConfirmedAt: z.date().optional(),
    accountantConfirmedBy: z.string().optional(),
    note: z.string().optional(),
  })
  .refine((profile) => profile.vatStatus !== "PAYER" || !!profile.vatRegisteredFrom, {
    message: "Platiteľ DPH musí mať dátum registrácie.",
    path: ["vatRegisteredFrom"],
  });

export const productVatRateSchema = z.object({
  productId: z.string().min(1),
  rate: z.number().int().min(0).max(100),
  validFrom: z.date(),
  validTo: z.date().optional(),
  confirmedAt: z.date().optional(),
  confirmedBy: z.string().optional(),
  sourceNote: z.string().optional(),
});

export const financePartySnapshotSchema = z.object({
  name: z.string().min(1),
  ico: z.string().optional(),
  dic: z.string().optional(),
  icDph: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  street: z.string().optional(),
  city: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().length(2).default("SK"),
  iban: z.string().optional(),
  bic: z.string().optional(),
});

export const financeInvoiceLineSchema = z.object({
  productId: z.string().optional(),
  description: z.string().min(1, "Popis položky je povinný"),
  productSku: z.string().optional(),
  quantity: z.number().positive("Množstvo musí byť kladné"),
  unit: z.string().min(1),
  unitPriceCents: z.number().int(),
  vatRate: z.number().int().min(0).max(100),
  taxCategory: z.enum(["STANDARD", "EXEMPT"]).default("STANDARD"),
});

export const financeInvoiceDraftSchema = z.object({
  direction: invoiceDirectionSchema,
  documentType: invoiceDocumentTypeSchema.default("INVOICE"),
  source: invoiceSourceSchema.default("INTERNA"),
  currency: currencySchema.default("EUR"),
  clientId: z.string().optional(),
  orderId: z.string().optional(),
  originalInvoiceId: z.string().optional(),
  issueDate: z.date(),
  dueDate: z.date(),
  deliveryDate: z.date().optional(),
  variableSymbol: z.string().optional(),
  note: z.string().optional(),
  items: z.array(financeInvoiceLineSchema).min(1, "Pridajte aspoň jednu položku"),
});

export const paymentAllocationInputSchema = z.object({
  paymentId: z.string().min(1),
  invoiceId: z.string().min(1),
  amountCents: z.number().int().positive("Alokovaná suma musí byť kladná"),
});

export const stockMovementSchema = z.object({
  type: movementTypeSchema,
  materialId: z.string().optional(),
  productId: z.string().optional(),
  quantity: z.number().refine((v) => v !== 0, "Množstvo nesmie byť 0"),
  unitPriceCents: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
}).refine(
  (data) => (data.materialId ? !data.productId : !!data.productId),
  "Vyplňte surovinu ALEBO produkt (presne jedno)",
);

// Payload pre POST /api/inbox — objednávky/faktúry z webu a budúce e-maily.
export const inboxPayloadSchema = z.object({
  source: inboxSourceSchema,
  fromEmail: z.string().email().optional(),
  subject: z.string().optional(),
  body: z.string().min(1),
  rawJson: z.unknown().optional(),
});

export const orderStatusLabels: Record<string, string> = {
  NOVA: "Nová",
  POTVRDENA: "Potvrdená",
  VO_VYROBE: "Vo výrobe",
  EXPEDOVANA: "Expedovaná",
  DORUCENA: "Doručená",
  ZRUSENA: "Zrušená",
};

export const orderChannelLabels: Record<string, string> = {
  MANUAL: "Manuálna",
  EMAIL: "E-mail",
  WEB: "Web",
  SUBSCRIPTION: "Predplatné",
};
