import type { MailMessage, MailProvider, MailResult } from "@/lib/finance/contracts";

/**
 * Vývojový/testovací provider — neposiela reálny e-mail, iba zaznamená
 * odoslanie do konzoly a vráti deterministický výsledok. Umožňuje odskúšať
 * celý reťazec (finalize → outbox → PDF → EmailDelivery SENT) bez SMTP.
 * Zoznam odoslaných správ je dostupný na introspekciu v testoch.
 */
export class LogMailProvider implements MailProvider {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailResult> {
    this.sent.push(message);
    if (process.env.NODE_ENV !== "test") {
      // eslint-disable-next-line no-console
      console.info(
        `[LogMailProvider] "${message.subject}" → ${message.to.join(", ")} (prílohy: ${message.documentIds.length})`,
      );
    }
    return {
      providerMessageId: `log-${message.idempotencyKey}`,
      acceptedRecipients: message.to,
      rejectedRecipients: [],
      submittedAt: new Date(),
    };
  }

  async getDeliveryStatus(): Promise<"SENT"> {
    return "SENT";
  }
}
