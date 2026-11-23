import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { renderDeliveryNotePdf } from "@/lib/finance/delivery/pdf";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor || !hasFinancePermission(actor.role, "VIEW")) return new Response(null, { status: 404 });
  const { id } = await params;
  const note = await prisma.deliveryNote.findUnique({ where: { id } });
  if (!note) return new Response(null, { status: 404 });
  const bytes = await renderDeliveryNotePdf(note, request.nextUrl.searchParams.get("ceny") === "1");
  return new Response(Uint8Array.from(bytes), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${note.number.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf"`,
    "Cache-Control": "private, no-store",
  } });
}
