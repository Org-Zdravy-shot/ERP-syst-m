import { NextResponse, type NextRequest } from "next/server";
import { enqueueDueReminders } from "@/lib/finance/outbox/reminders";
import { processPendingOutbox } from "@/lib/finance/outbox/worker";

/**
 * Railway cron (napr. denne ráno): zaradí upomienky pre faktúry po splatnosti
 * a hneď ich odošle cez outbox. Idempotentné — jedna faktúra max jedna
 * upomienka za týždeň. POST /api/cron/reminders s x-cron-secret.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: "CRON_SECRET nie je nakonfigurovaný" }, { status: 503 });
  }
  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Neplatný cron secret" }, { status: 401 });
  }

  const reminders = await enqueueDueReminders();
  const outbox = await processPendingOutbox(100);
  return NextResponse.json({ status: "done", reminders, outbox });
}
