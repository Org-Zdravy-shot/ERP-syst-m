import { z } from "zod";

/** GS1 SK FMCG v1.9, sheet AdditionalItemProperty, A11:A48.
 * Values are metadata, never extra charges added to the invoice totals.
 */
const text = z.string().trim().min(1).max(512).refine(
  (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(value),
  "Text obsahuje nepovolený XML znak",
);
const decimal = text.regex(/^-?\d{1,12}(?:\.\d{1,4})?$/, "Použite desatinné číslo s bodkou, najviac 4 desatinné miesta");
const date = text.refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Dátum musí byť platný vo formáte RRRR-MM-DD");

function validGs1(value: string): boolean {
  const digits = [...value].map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === check;
}

const gln = text.regex(/^\d{13}$/, "GLN musí mať 13 číslic").refine(validGs1, "Nesprávna kontrolná číslica GLN");
const gtin = text.regex(/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/, "GTIN musí mať 8, 12, 13 alebo 14 číslic").refine(validGs1, "Nesprávna kontrolná číslica GTIN");

export const fmcgPropertySchema = z.object({
  item_type: z.enum(["Z", "O", "S"]).optional(),
  units_per_carton: decimal.optional(),
  delivery_date: date.optional(),
  excise_duty_category_code: text.optional(),
  excise_duty_basis: decimal.optional(),
  excise_duty_amount: decimal.optional(),
  buyer_order_number: text.optional(),
  buyer_order_date: date.optional(),
  supplier_order_number: text.optional(),
  supplier_order_date: date.optional(),
  delivery_note_number: text.optional(),
  delivery_note_date: date.optional(),
  receiving_advice_number: text.optional(),
  receiving_advice_date: date.optional(),
  invoice_reference_type: z.enum(["AAB", "IV"]).optional(),
  invoice_reference_number: text.optional(),
  invoice_reference_date: date.optional(),
  free_reference: text.optional(),
  free_reference_date: date.optional(),
  ordered_by_gln: gln.optional(),
  delivery_party_gln: gln.optional(),
  store_number_gln: gln.optional(),
  ultimate_customer_gln: gln.optional(),
  ultimate_customer_name: text.optional(),
  // v1.9 has inconsistent char/num labels for fee types; retain the supplied code.
  recycling_fee_type: text.optional(),
  recycling_fee_amount: decimal.optional(),
  recycling_fee_per_unit: decimal.optional(),
  recycling_fee_unit: text.optional(),
  copyright_fee_type: text.optional(),
  copyright_fee_amount: decimal.optional(),
  copyright_fee_per_unit: decimal.optional(),
  copyright_fee_unit: text.optional(),
  free_text_law: text.optional(),
  sukl_id: text.optional(),
  batch_number: text.optional(),
  consumer_unit_price: decimal.optional(),
  expiry_date: date.optional(),
  vat_amount: decimal.optional(),
}).strict();

export const fmcgLineSchema = z.object({
  gtin: gtin.optional(),
  properties: fmcgPropertySchema,
}).strict();

export type FmcgLineMetadata = z.infer<typeof fmcgLineSchema>;

export function parseFmcgLine(value: unknown, lineNumber: number): FmcgLineMetadata {
  const parsed = fmcgLineSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Riadok ${lineNumber}, FMCG ${issue.path.join(".") || "údaje"}: ${issue.message}`);
  }
  return parsed.data;
}
