import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { inboxPayloadSchema } from "@/lib/zod-schemas";
import { configuredSecret, secretMatches } from "@/lib/security/secrets";

/**
 * Jednotný vstupný bod pre externé systémy: webový e-shop (objednávky/dopyty)
 * a v budúcnosti e-mailový parser. Zabezpečené hlavičkou x-api-key.
 *
 * POST /api/inbox
 * { "source": "WEB_FORM", "fromEmail": "...", "subject": "...", "body": "...", "rawJson": {...} }
 */
export async function POST(request: NextRequest) {
  const configuredApiKey = process.env.INBOX_API_KEY;
  if (!configuredSecret(configuredApiKey)) {
    return NextResponse.json({ error: "Inbox API nie je nakonfigurované" }, { status: 503 });
  }
  if (!secretMatches(configuredApiKey, request.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "Neplatný API kľúč" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatný JSON" }, { status: 400 });
  }

  const parsed = inboxPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Neplatný payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const message = await prisma.inboxMessage.create({
    data: {
      source: parsed.data.source,
      fromEmail: parsed.data.fromEmail ?? null,
      subject: parsed.data.subject ?? null,
      body: parsed.data.body,
      rawJson: parsed.data.rawJson ? JSON.stringify(parsed.data.rawJson) : null,
    },
  });

  return NextResponse.json({ id: message.id, status: message.status }, { status: 201 });
}
