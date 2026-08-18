import { NextResponse, type NextRequest } from "next/server";
import { fetchSintelExport, sintelConfigured } from "@/app/(app)/konkurencia/sintel";
import { configuredSecret, secretMatches } from "@/lib/security/secrets";

/**
 * Napojenie externého modelu na sledovanie konkurencie (FULL SINTEL).
 * Stránka /konkurencia číta SINTEL priamo v server componente; tento
 * endpoint sprístupňuje tie isté dáta ďalším externým systémom.
 * Zabezpečené hlavičkou x-api-key (INBOX_API_KEY — rovnaký vzor ako /api/inbox).
 *
 * GET /api/konkurencia  →  export FULL SINTEL (konkurenti, top príspevky, rady)
 */
export async function GET(request: NextRequest) {
  const configuredApiKey = process.env.INBOX_API_KEY;
  if (!configuredSecret(configuredApiKey)) {
    return NextResponse.json({ error: "Externé API nie je nakonfigurované" }, { status: 503 });
  }
  if (!secretMatches(configuredApiKey, request.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "Neplatný API kľúč" }, { status: 401 });
  }

  if (!sintelConfigured()) {
    return NextResponse.json(
      { status: "not_configured", message: "Nastav SINTEL_API_URL a SINTEL_API_KEY v .env." },
      { status: 503 },
    );
  }

  const data = await fetchSintelExport();
  if (!data) {
    return NextResponse.json(
      { status: "upstream_error", message: "Dáta z FULL SINTEL sa nepodarilo načítať." },
      { status: 502 },
    );
  }
  return NextResponse.json(data);
}
