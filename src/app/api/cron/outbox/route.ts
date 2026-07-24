import { NextResponse, type NextRequest } from "next/server";
import { processPendingOutbox } from "@/lib/finance/outbox/worker";

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
  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Neplatný cron secret" }, { status: 401 });
  }

  const summary = await processPendingOutbox(100);
  return NextResponse.json({ status: "done", ...summary });
}
