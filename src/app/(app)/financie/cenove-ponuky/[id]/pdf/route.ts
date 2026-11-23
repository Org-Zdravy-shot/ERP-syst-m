import { getCurrentUser } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { renderDeliveryNotePdf } from "@/lib/finance/delivery/pdf";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor || !hasFinancePermission(actor.role, "VIEW")) return new Response(null, { status: 404 });
  const { id } = await params;
  const quote = await prisma.salesQuote.findUnique({ where: { id } });
  if (!quote) return new Response(null, { status: 404 });
  const bytes = await renderDeliveryNotePdf({
    ...quote, deliveryDate: quote.validUntil, cancelledAt: null, deliveryAddress: null, buyerOrderNumber: null, supplierOrderNumber: null,
  }, true, quote);
  return new Response(Uint8Array.from(bytes), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${quote.number.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf"`,
    "Cache-Control": "private, no-store",
  } });
}
