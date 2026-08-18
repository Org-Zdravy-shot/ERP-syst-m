import { type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invoiceService } from "@/lib/finance/invoice-service";
import { hasFinancePermission } from "@/lib/finance/permissions";

function parseDate(value: string | null, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const date = new Date(endOfDay ? `${value}T23:59:59.999` : `${value}T00:00:00.000`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** CSV export finalizovaných faktúr pre účtovníka. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Neprihlásený", { status: 401 });
  if (!hasFinancePermission(user.role, "EXPORT")) {
    return new Response("Na export financií nemáte oprávnenie.", { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const direction = params.get("smer");
  const source = params.get("zdroj");
  const dateFrom = parseDate(params.get("od"));
  const dateTo = parseDate(params.get("do"), true);
  const includeCancelled = params.get("stornovane") === "1";
  const acceptedDirection = direction === "VYDANA" || direction === "PRIJATA" ? direction : undefined;
  const acceptedSource =
    source === "INTERNA" || source === "WEB" || source === "SUPERFAKTURA" || source === "OMEGA"
      ? source
      : undefined;
  const exported = await invoiceService.exportAccounting({
    ...(acceptedDirection ? { direction: acceptedDirection } : {}),
    ...(acceptedSource ? { source: acceptedSource } : {}),
    dateFrom,
    dateTo,
    includeCancelled,
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.userId,
      actorEmail: user.email,
      action: "ACCOUNTING_EXPORT_DOWNLOADED",
      entityType: "AccountingExport",
      entityId: exported.sha256,
      metadata: {
        invoiceCount: exported.invoiceCount,
        totalGrossCents: exported.totalGrossCents,
        filters: {
          direction: acceptedDirection,
          source: acceptedSource,
          dateFrom: dateFrom?.toISOString(),
          dateTo: dateTo?.toISOString(),
          includeCancelled,
        },
      },
    },
  });

  return new Response(Buffer.from(exported.content), {
    headers: {
      "Content-Type": exported.contentType,
      "Content-Disposition": `attachment; filename="${exported.fileName}"`,
      "X-Content-SHA256": exported.sha256,
      "Cache-Control": "private, no-store",
    },
  });
}
