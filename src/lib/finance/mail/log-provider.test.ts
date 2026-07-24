import { describe, expect, it } from "vitest";
import { LogMailProvider } from "./log-provider";
import type { MailMessage } from "@/lib/finance/contracts";

function message(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    idempotencyKey: "evt-1",
    invoiceId: "inv-1",
    from: "info@zdravyshot.sk",
    to: ["klient@example.sk"],
    subject: "Faktúra 2026009",
    text: "…",
    documentIds: ["doc-1"],
    ...overrides,
  };
}

describe("LogMailProvider", () => {
  it("zaznamená odoslanú správu a vráti deterministický messageId", async () => {
    const provider = new LogMailProvider();
    const result = await provider.send(message());
    expect(provider.sent).toHaveLength(1);
    expect(result.providerMessageId).toBe("log-evt-1");
    expect(result.acceptedRecipients).toEqual(["klient@example.sk"]);
    expect(result.rejectedRecipients).toEqual([]);
  });

  it("getDeliveryStatus vracia SENT", async () => {
    const provider = new LogMailProvider();
    expect(await provider.getDeliveryStatus()).toBe("SENT");
  });
});
