import { z } from "zod";

export const deliveryLineSchema = z.object({
  productId: z.string().min(1).max(100).optional(),
  productSku: z.string().min(1).max(100).optional(),
  description: z.string().trim().min(1, "Zadajte názov položky.").max(300),
  quantity: z.number().min(0.000001).max(1_000_000).refine(n => /^\d+(\.\d{1,6})?$/.test(String(n)), "Najviac 6 desatinných miest množstva."),
  unit: z.string().trim().min(1).max(20),
  unitPriceExact: z.string().trim().max(40).optional(),
  vatRate: z.number().int().min(0).max(100).optional(),
  kind: z.enum(["GOODS", "CHARGE"]).default("GOODS"),
});
export const deliveryLinesSchema = z.array(deliveryLineSchema).min(1, "Pridajte aspoň jednu položku.").max(100);
export type DeliveryLine = z.infer<typeof deliveryLineSchema>;

const id = z.string().min(1).max(100);
const money = z.string().trim().min(1).max(40);
export const issueDeliveryNoteSchema = z.object({
  submissionKey: z.uuid(),
  orderId: id.optional(),
  expectedOrderUpdatedAt: z.iso.datetime().optional(),
  legalEntity: z.enum(["KURGI", "SOLE_TRADER"]).optional(),
  clientId: id.optional(),
  issueDate: z.iso.date(),
  deliveryDate: z.iso.date(),
  buyerOrderNumber: z.string().trim().min(1).max(140).optional(),
  deliveryAddress: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
  lines: deliveryLinesSchema.optional(),
});
export const deliveryNoteIdsSchema = z.array(id).min(1, "Vyberte aspoň jeden dodací list.").max(50, "Vyberte najviac 50 dodacích listov.");
export const invoiceDeliveryNotesSchema = z.object({
  ids: deliveryNoteIdsSchema,
  missingPrices: z.array(z.object({ noteId: id, index: z.number().int().min(0).max(99), price: money })).max(300),
});
export type DeliveryNoteInput = z.input<typeof issueDeliveryNoteSchema>;
export type InvoiceDeliverySelection = z.infer<typeof invoiceDeliveryNotesSchema>;

export const invoiceKeepsDelivery = { OR: [
  { documentStatus: { not: "CANCELLED" } },
  { finalizedAt: { not: null } },
] } as const;
