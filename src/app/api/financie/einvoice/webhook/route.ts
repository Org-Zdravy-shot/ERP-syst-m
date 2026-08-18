import { NextResponse, type NextRequest } from "next/server";
import { readEFakturaConfig } from "@/lib/finance/einvoice/config";
import {
  EFakturaWebhookError,
  parseEFakturaWebhookPayload,
  persistEFakturaWebhook,
} from "@/lib/finance/einvoice/webhook-handler";
import { verifyEFakturaWebhook } from "@/lib/finance/einvoice/webhook";
import { configuredSecret } from "@/lib/security/secrets";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 256 * 1024;

export async function POST(request: NextRequest) {
  let config;
  try {
    config = readEFakturaConfig();
  } catch {
    return NextResponse.json({ error: "eFaktúra webhook nie je aktívny." }, { status: 503 });
  }
  if (!configuredSecret(config.webhookSecret)) {
    return NextResponse.json({ error: "Chýba webhook secret." }, { status: 503 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook payload je príliš veľký." }, { status: 413 });
  }

  const signature = request.headers.get("x-webhook-signature") ?? "";
  const webhookId = request.headers.get("x-webhook-id")?.trim() ?? "";
  const headerEvent = request.headers.get("x-webhook-event")?.trim() ?? "";
  if (!webhookId || webhookId.length > 200 || !headerEvent) {
    return NextResponse.json({ error: "Chýbajú povinné webhook hlavičky." }, { status: 400 });
  }

  const rawBytes = new Uint8Array(await request.arrayBuffer());
  if (rawBytes.byteLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook payload je príliš veľký." }, { status: 413 });
  }
  if (!verifyEFakturaWebhook({ rawBody: rawBytes, signatureHeader: signature, secret: config.webhookSecret })) {
    return NextResponse.json({ error: "Neplatný alebo expirovaný webhook podpis." }, { status: 401 });
  }

  try {
    const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
    const webhook = parseEFakturaWebhookPayload({
      rawBody,
      headerEvent,
      expectedOrganizationId: config.organizationId,
      mode: config.mode,
    });
    const result = await persistEFakturaWebhook({ webhookId, mode: config.mode, webhook });
    return NextResponse.json(
      { accepted: true, status: result.status },
      { status: result.status === "pending" ? 202 : 200 },
    );
  } catch (error) {
    if (error instanceof EFakturaWebhookError || error instanceof TypeError) {
      return NextResponse.json({ error: "Neplatný webhook payload." }, { status: 400 });
    }
    console.error("Spracovanie eFaktúra webhooku zlyhalo:", error instanceof Error ? error.message : "neznáma chyba");
    return NextResponse.json({ error: "Webhook sa nepodarilo uložiť." }, { status: 500 });
  }
}
