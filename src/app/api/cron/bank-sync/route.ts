import { NextResponse, type NextRequest } from "next/server";
import { runBankSync } from "@/lib/finance/banking/sync";
import { tatraPremiumEnabled } from "@/lib/finance/banking/flags";
import { configuredSecret, secretMatches } from "@/lib/security/secrets";

/**
 * Railway cron: každých 15 minút POST na tento endpoint s hlavičkou
 * x-cron-secret (CRON_SECRET v Railway variables). Idempotentné — opakované
 * volanie neimportuje duplikáty (unikátnosť bankových transakcií).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!configuredSecret(secret)) {
    return NextResponse.json({ error: "CRON_SECRET nie je nakonfigurovaný" }, { status: 503 });
  }
  if (!secretMatches(secret, request.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Neplatný cron secret" }, { status: 401 });
  }

  if (!tatraPremiumEnabled()) {
    return NextResponse.json({ status: "skipped", reason: "Tatra Premium API je vypnuté (feature flag)." });
  }

  const summaries = await runBankSync();
  const failed = summaries.some((summary) => summary.error);
  return NextResponse.json(
    { status: failed ? "failed" : "done", connections: summaries },
    { status: failed ? 502 : 200 },
  );
}
