import { describe, expect, it } from "vitest";
import {
  EFakturaWebhookError,
  parseEFakturaWebhookPayload,
  shouldApplyTransmissionWebhook,
  transmissionUpdateForWebhook,
} from "./webhook-handler";

function body(
  event: string,
  data: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    event,
    timestamp: "2026-08-18T13:00:00.000Z",
    data: { orgId: "org-1", mode: "test", ...data },
  });
}

describe("eFaktura.sk webhook payload", () => {
  it("overí event, organizáciu a sandbox režim", () => {
    const parsed = parseEFakturaWebhookPayload({
      rawBody: body("peppol.document.sent", { invoiceId: "provider-invoice-1", state: "SENT" }),
      headerEvent: "peppol.document.sent",
      expectedOrganizationId: "org-1",
      mode: "sandbox",
    });

    expect(parsed.event).toBe("peppol.document.sent");
    expect(parsed.occurredAt.toISOString()).toBe("2026-08-18T13:00:00.000Z");
    expect(transmissionUpdateForWebhook(parsed)).toMatchObject({
      providerInvoiceId: "provider-invoice-1",
      status: "SENT",
      providerState: "SENT",
    });
  });

  it("mapuje doručenie a finálne zlyhanie", () => {
    const delivered = parseEFakturaWebhookPayload({
      rawBody: body("peppol.document.delivered", { invoiceId: "invoice-1", state: "DELIVERED" }),
      headerEvent: "peppol.document.delivered",
      expectedOrganizationId: "org-1",
      mode: "sandbox",
    });
    expect(transmissionUpdateForWebhook(delivered)).toMatchObject({
      status: "DELIVERED",
      deliveredAt: new Date("2026-08-18T13:00:00.000Z"),
    });

    const failed = parseEFakturaWebhookPayload({
      rawBody: body("peppol.document.failed", { invoiceId: "invoice-1", error: "recipient not found" }),
      headerEvent: "peppol.document.failed",
      expectedOrganizationId: "org-1",
      mode: "sandbox",
    });
    expect(transmissionUpdateForWebhook(failed)).toMatchObject({
      status: "FAILED",
      lastError: "recipient not found",
    });
  });

  it("prijatý doklad je notifikácia pre autoritatívny polling", () => {
    const received = parseEFakturaWebhookPayload({
      rawBody: body("peppol.document.received", { documentNumber: "VF-42" }),
      headerEvent: "peppol.document.received",
      expectedOrganizationId: "org-1",
      mode: "sandbox",
    });
    expect(transmissionUpdateForWebhook(received)).toBeNull();
  });

  it("odmietne neplatný JSON a nepodporovaný event", () => {
    expect(() =>
      parseEFakturaWebhookPayload({
        rawBody: "nie-json",
        headerEvent: "peppol.document.sent",
        expectedOrganizationId: "org-1",
        mode: "sandbox",
      }),
    ).toThrow(EFakturaWebhookError);
    expect(() =>
      parseEFakturaWebhookPayload({
        rawBody: body("unknown.event"),
        headerEvent: "unknown.event",
        expectedOrganizationId: "org-1",
        mode: "sandbox",
      }),
    ).toThrow(/platnú obálku/);
  });

  it("odmietne rozdielny header, organizáciu a prostredie", () => {
    const validBody = body("peppol.document.sent", { invoiceId: "invoice-1" });
    expect(() =>
      parseEFakturaWebhookPayload({
        rawBody: validBody,
        headerEvent: "peppol.document.failed",
        expectedOrganizationId: "org-1",
        mode: "sandbox",
      }),
    ).toThrow(/hlavičke a tele/);
    expect(() =>
      parseEFakturaWebhookPayload({
        rawBody: validBody,
        headerEvent: "peppol.document.sent",
        expectedOrganizationId: "other-org",
        mode: "sandbox",
      }),
    ).toThrow(/inej organizácii/);
    expect(() =>
      parseEFakturaWebhookPayload({
        rawBody: validBody,
        headerEvent: "peppol.document.sent",
        expectedOrganizationId: "org-1",
        mode: "production",
      }),
    ).toThrow(/Testovací webhook/);
  });

  it("stavový event musí obsahovať provider invoiceId", () => {
    const parsed = parseEFakturaWebhookPayload({
      rawBody: body("peppol.document.sent"),
      headerEvent: "peppol.document.sent",
      expectedOrganizationId: "org-1",
      mode: "sandbox",
    });
    expect(() => transmissionUpdateForWebhook(parsed)).toThrow(/invoiceId/);
  });

  it("oneskorený webhook nezhorší terminálny stav", () => {
    expect(shouldApplyTransmissionWebhook("DELIVERED", "SENT")).toBe(false);
    expect(shouldApplyTransmissionWebhook("DELIVERED", "FAILED")).toBe(false);
    expect(shouldApplyTransmissionWebhook("FAILED", "SENT")).toBe(false);
    expect(shouldApplyTransmissionWebhook("SENT", "DELIVERED")).toBe(true);
    expect(shouldApplyTransmissionWebhook("QUEUED", "FAILED")).toBe(true);
  });
});
