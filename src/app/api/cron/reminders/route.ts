import { NextResponse, type NextRequest } from "next/server";
import { enqueueDueReminders } from "@/lib/finance/outbox/reminders";
import { processPendingOutbox } from "@/lib/finance/outbox/worker";
import { configuredSecret, secretMatches } from "@/lib/security/secrets";

export const runtime = "nodejs";

/**
 * Railway cron (napr. denne ráno): zaradí upomienky pre faktúry po splatnosti
 * a hneď ich odošle cez outbox. Idempotentné — jedna faktúra max jedna
 * upomienka za týždeň. POST /api/cron/reminders s x-cron-secret.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!configuredSecret(secret)) {
    return NextResponse.json({ error: "CRON_SECRET nie je nakonfigurovaný" }, { status: 503 });
  }
  if (!secretMatches(secret, request.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Neplatný cron secret" }, { status: 401 });
  }

  try {
    const reminders = await enqueueDueReminders();
    const outbox = await processPendingOutbox(100);
    return NextResponse.json(
      {
        status: outbox.failed > 0 ? "failed" : "done",
        reminders,
        outbox,
      },
      { status: outbox.failed > 0 ? 502 : 200 },
    );
  } catch (error) {
    console.error(
      "Cron upomienok zlyhal:",
      error instanceof Error ? error.message : "neznáma chyba",
    );
    return NextResponse.json(
      { error: "Upomienky sa nepodarilo spracovať." },
      { status: 500 },
    );
  }
}
