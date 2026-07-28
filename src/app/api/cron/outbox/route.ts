import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { processPendingOutbox } from "@/lib/finance/outbox/worker";

export const runtime = "nodejs";

function authorized(request: NextRequest, secret: string): boolean {
  const expected = Buffer.from(secret);
  const supplied = Buffer.from(request.headers.get("x-cron-secret") ?? "");
  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}

/**
 * Railway cron: spracovanie outbox udalostí (generovanie PDF, odoslanie
 * e-mailov, upomienky). Idempotentné — opakované volanie neposiela duplikáty.
 * POST /api/cron/outbox s hlavičkou x-cron-secret (CRON_SECRET).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: "CRON_SECRET nie je nakonfigurovaný" }, { status: 503 });
  }
  if (!authorized(request, secret)) {
    return NextResponse.json({ error: "Neplatný cron secret" }, { status: 401 });
  }

  try {
    const summary = await processPendingOutbox(100);
    return NextResponse.json(
      { status: summary.failed > 0 ? "failed" : "done", ...summary },
      { status: summary.failed > 0 ? 502 : 200 },
    );
  } catch (error) {
    console.error(
      "Outbox cron zlyhal:",
      error instanceof Error ? error.message : "neznáma chyba",
    );
    return NextResponse.json(
      { error: "Outbox sa nepodarilo spracovať." },
      { status: 500 },
    );
  }
}
