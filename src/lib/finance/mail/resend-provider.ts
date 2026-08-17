import { createHash } from "node:crypto";
import type { MailMessage, MailProvider, MailResult } from "@/lib/finance/contracts";
import { MAIL_FROM, MAIL_FROM_NAME, readResendConfig } from "./config";
import type { AttachmentLoader } from "./types";

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";

interface ResendResponseBody {
  id?: unknown;
  message?: unknown;
  name?: unknown;
}

function idempotencyKey(value: string): string {
  const candidate = `finance-email/${value}`;
  if (candidate.length <= 256) return candidate;
  return `finance-email/${createHash("sha256").update(value).digest("hex")}`;
}

function responseMessage(body: ResendResponseBody, status: number): string {
  const detail = typeof body.message === "string"
    ? body.message
    : typeof body.name === "string"
      ? body.name
      : "neznáma chyba";
  return `Resend API odmietlo e-mail (${status}): ${detail}`;
}

/**
 * HTTPS implementácia MailProvider pre Railway Hobby, kde sú odchádzajúce
 * SMTP porty blokované. Resend dostáva iba hotový obsah a hashom overené PDF.
 */
export class ResendMailProvider implements MailProvider {
  readonly providerName = "RESEND";

  constructor(
    private readonly attachments: AttachmentLoader,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: MailMessage): Promise<MailResult> {
    if (message.from.trim().toLowerCase() !== MAIL_FROM.toLowerCase()) {
      throw new Error(`Resend odosielateľ musí byť ${MAIL_FROM}.`);
    }
    const config = readResendConfig();
    const attachments = await Promise.all(
      message.documentIds.map(async (id) => {
        const file = await this.attachments.load(id);
        return {
          filename: file.fileName,
          content: Buffer.from(file.bytes).toString("base64"),
        };
      }),
    );

    const response = await this.fetchImpl(RESEND_EMAILS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey(message.idempotencyKey),
      },
      body: JSON.stringify({
        from: `${MAIL_FROM_NAME} <${message.from}>`,
        to: message.to,
        reply_to: message.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments,
      }),
    });

    const body = await response.json().catch(() => ({})) as ResendResponseBody;
    if (!response.ok) throw new Error(responseMessage(body, response.status));
    if (typeof body.id !== "string" || !body.id) {
      throw new Error("Resend API nevrátilo identifikátor odoslaného e-mailu.");
    }

    return {
      providerMessageId: body.id,
      acceptedRecipients: message.to,
      rejectedRecipients: [],
      submittedAt: new Date(),
    };
  }

  async getDeliveryStatus(): Promise<"SENT"> {
    // Webhooky pre DELIVERED/BOUNCED doplníme samostatne; API prijatie = SENT.
    return "SENT";
  }
}
