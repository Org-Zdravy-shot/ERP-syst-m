import { z } from "zod";
import { computeTotals } from "@/lib/invoicing";

const money = z.string().max(32);
const lineSchema = z.object({
  sku: z.string().max(100), name: z.string().max(300),
  quantity: z.number().int().positive().max(100_000),
  total: money, total_tax: money,
});

export const wooOrderSchema = z.object({
  id: z.number().int().positive(),
  number: z.union([z.string(), z.number()]).optional(),
  status: z.string().max(40),
  currency: z.string().max(8),
  date_created_gmt: z.string().nullable().optional(),
  date_modified_gmt: z.string().nullable().optional(),
  customer_note: z.string().max(1000).optional(),
  billing: z.object({
    first_name: z.string().max(100).optional(), last_name: z.string().max(100).optional(),
    company: z.string().max(200).optional(), email: z.string().max(255),
    phone: z.string().max(100).optional(), address_1: z.string().max(200).optional(),
    city: z.string().max(100).optional(), postcode: z.string().max(30).optional(),
  }),
  line_items: z.array(lineSchema).max(500),
  shipping_total: money,
  shipping_tax: money,
  fee_lines: z.array(z.object({ name: z.string().max(200).optional(), total: money, total_tax: money })).optional(),
  total: money,
  total_tax: money,
});

export type WooOrderPayload = z.infer<typeof wooOrderSchema>;

export function wooMoneyToCents(value: string): number {
  if (!/^\d+(?:\.\d{1,4})?$/.test(value)) throw new Error("Neplatná peňažná suma z WooCommerce.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > 2 && /[^0]/.test(fraction.slice(2))) {
    throw new Error("WooCommerce suma má viac než dve platné desatinné miesta.");
  }
  const cents = Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) throw new Error("WooCommerce suma je mimo rozsahu.");
  return cents;
}

export function wooGmtDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface MappedProduct { id: string; sku: string; name: string; vatRate: number; isActive: boolean }
export interface MappedOrderLine { productId: string; quantity: number; unitPriceCents: number; vatRate: number }
export interface MappedOrderCharge { kind: "SHIPPING" | "FEE"; description: string; unitPriceCents: number; vatRate: number }

function deriveVatRate(net: number, tax: number): number {
  const candidates = Array.from({ length: 101 }, (_, rate) => rate)
    .filter((rate) => Math.round(net * rate / 100) === tax);
  if (candidates.length !== 1) throw new Error("DPH dopravy alebo poplatku nie je jednoznačná; treba ručnú kontrolu.");
  return candidates[0];
}

export function mapWooOrder(order: WooOrderPayload, products: readonly MappedProduct[]): { lines: MappedOrderLine[]; charges: MappedOrderCharge[] } {
  if (order.currency !== "EUR") throw new Error("Objednávka nie je v EUR.");
  if (!order.line_items.length) throw new Error("Objednávka nemá žiadne produktové položky.");
  const result: MappedOrderLine[] = [];
  for (const line of order.line_items) {
    const matches = products.filter((product) => product.sku.toLowerCase() === line.sku.trim().toLowerCase());
    if (!line.sku.trim() || matches.length !== 1) throw new Error(`Produkt „${line.name}“ nemá jednoznačné SKU v ERP.`);
    const product = matches[0];
    if (!product.isActive) throw new Error(`Produkt „${line.name}“ je v ERP neaktívny.`);
    const net = wooMoneyToCents(line.total);
    const tax = wooMoneyToCents(line.total_tax);
    const lower = Math.floor(net / line.quantity);
    const higherCount = net % line.quantity;
    if (line.quantity - higherCount) result.push({ productId: product.id, quantity: line.quantity - higherCount, unitPriceCents: lower, vatRate: product.vatRate });
    if (higherCount) result.push({ productId: product.id, quantity: higherCount, unitPriceCents: lower + 1, vatRate: product.vatRate });
    const mappedTax = computeTotals(result.slice(-((line.quantity - higherCount ? 1 : 0) + (higherCount ? 1 : 0)))).totalVatCents;
    if (mappedTax !== tax) throw new Error(`DPH produktu „${line.name}“ sa nezhoduje s ERP sadzbou; treba ručnú kontrolu.`);
  }
  const charges: MappedOrderCharge[] = [];
  const shippingNet = wooMoneyToCents(order.shipping_total);
  const shippingTax = wooMoneyToCents(order.shipping_tax);
  if (shippingNet || shippingTax) {
    charges.push({ kind: "SHIPPING", description: "Doprava", unitPriceCents: shippingNet,
      vatRate: deriveVatRate(shippingNet, shippingTax) });
  }
  for (const fee of order.fee_lines ?? []) {
    const net = wooMoneyToCents(fee.total);
    const tax = wooMoneyToCents(fee.total_tax);
    if (net || tax) charges.push({ kind: "FEE", description: fee.name?.trim() || "Poplatok",
      unitPriceCents: net, vatRate: deriveVatRate(net, tax) });
  }
  const totals = computeTotals([...result, ...charges.map((charge) => ({ quantity: 1, ...charge }))]);
  if (totals.totalGrossCents !== wooMoneyToCents(order.total) || totals.totalVatCents !== wooMoneyToCents(order.total_tax)) {
    throw new Error("Súčet položiek sa nezhoduje s WooCommerce objednávkou; treba ručnú kontrolu.");
  }
  return { lines: result, charges };
}
