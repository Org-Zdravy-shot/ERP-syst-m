import nodemailer, { type Transporter } from "nodemailer";
import type { MailMessage, MailProvider, MailResult } from "@/lib/finance/contracts";
import { MAIL_FROM_NAME, readSmtpConfig } from "./config";
import type { AttachmentLoader } from "./types";

/**
 * Vendor-neutrálny MailProvider cez SMTP (nodemailer). Funguje s ľubovoľným
 * transakčným poskytovateľom (Railway + jeho SMTP). Delivery/bounce cez
 * webhook je vec poskytovateľa a druhej etapy; SMTP dáva accepted/rejected
 * a message-id pri odoslaní → EmailDelivery.status SENT/FAILED.
 */
export class SmtpMailProvider implements MailProvider {
  private transporter: Transporter | undefined;

  constructor(private readonly attachments: AttachmentLoader) {}

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const cfg = readSmtpConfig();
      this.transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      });
    }
    return this.transporter;
  }

  async send(message: MailMessage): Promise<MailResult> {
    const attachments = await Promise.all(
      message.documentIds.map(async (id) => {
        const file = await this.attachments.load(id);
        return { filename: file.fileName, content: Buffer.from(file.bytes), contentType: file.contentType };
      }),
    );

    const info = await this.getTransporter().sendMail({
      from: { name: MAIL_FROM_NAME, address: message.from },
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments,
    });

    const accepted = (info.accepted ?? []).map(String);
    const rejected = (info.rejected ?? []).map(String);
    if (accepted.length === 0) {
      throw new Error(`SMTP odmietol všetkých príjemcov: ${rejected.join(", ") || "neznáme"}`);
    }

    return {
      providerMessageId: info.messageId ?? `smtp-${Date.now()}`,
      acceptedRecipients: accepted,
      rejectedRecipients: rejected,
      submittedAt: new Date(),
    };
  }

  async getDeliveryStatus(): Promise<"PENDING" | "SENT" | "DELIVERED" | "FAILED" | "BOUNCED"> {
    // Bez webhookov nevieme potvrdiť doručenie — ostáva na SENT.
    return "SENT";
  }
}
