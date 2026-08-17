import type { MailMessage } from "@/lib/finance/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendMailProvider } from "./resend-provider";

const originalApiKey = process.env.RESEND_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalApiKey;
});

const message: MailMessage = {
  idempotencyKey: "outbox-event-1",
  invoiceId: "invoice-1",
  from: "info@zdravyshot.sk",
  to: ["zakaznik@example.sk"],
  replyTo: "info@zdravyshot.sk",
  subject: "Faktúra 2026009",
  text: "Dobrý deň",
  html: "<p>Dobrý deň</p>",
  documentIds: ["document-1"],
};

describe("ResendMailProvider", () => {
  it("odošle idempotentnú HTTPS požiadavku s PDF prílohou", async () => {
    process.env.RESEND_API_KEY = "re_secret_test";
    const load = vi.fn().mockResolvedValue({
      fileName: "faktura-2026009.pdf",
      contentType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]),
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: "resend-message-1" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const provider = new ResendMailProvider(
      { load },
      fetchMock as unknown as typeof fetch,
    );

    const result = await provider.send(message);

    expect(result).toEqual(expect.objectContaining({
      providerMessageId: "resend-message-1",
      acceptedRecipients: ["zakaznik@example.sk"],
      rejectedRecipients: [],
    }));
    expect(load).toHaveBeenCalledWith("document-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual(expect.objectContaining({
      Authorization: "Bearer re_secret_test",
      "Idempotency-Key": "finance-email/outbox-event-1",
    }));
    expect(JSON.parse(String(init.body))).toEqual({
      from: "Zdravý Shot <info@zdravyshot.sk>",
      to: ["zakaznik@example.sk"],
      reply_to: "info@zdravyshot.sk",
      subject: "Faktúra 2026009",
      text: "Dobrý deň",
      html: "<p>Dobrý deň</p>",
      attachments: [{ filename: "faktura-2026009.pdf", content: "AQID" }],
    });
  });

  it("vráti bezpečnú chybu API bez sprístupnenia kľúča", async () => {
    process.env.RESEND_API_KEY = "re_secret_test";
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: "Domain is not verified" }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    ));
    const provider = new ResendMailProvider(
      { load: vi.fn() },
      fetchMock as unknown as typeof fetch,
    );

    await expect(provider.send({ ...message, documentIds: [] }))
      .rejects.toThrow("Resend API odmietlo e-mail (422): Domain is not verified");
    await expect(provider.send({ ...message, documentIds: [] }))
      .rejects.not.toThrow(/re_secret_test/);
  });
});
