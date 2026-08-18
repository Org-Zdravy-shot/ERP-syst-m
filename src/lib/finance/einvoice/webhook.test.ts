import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyEFakturaWebhook } from "./webhook";

const secret = "webhook-secret-for-tests";
const timestamp = 1_776_508_800;
const rawBody = '{"event":"peppol.document.delivered","data":{"invoiceId":"invoice-1"}}';

function signature(body = rawBody): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

describe("eFaktura.sk webhook podpis", () => {
  it("overí raw telo a podporí paralelný podpis pri rotácii secretu", () => {
    expect(
      verifyEFakturaWebhook({
        rawBody,
        signatureHeader: `t=${timestamp},v1=${"0".repeat(64)},v1=${signature()}`,
        secret,
        nowMs: timestamp * 1000,
      }),
    ).toBe(true);
  });

  it("odmietne zmenené telo", () => {
    expect(
      verifyEFakturaWebhook({
        rawBody: `${rawBody} `,
        signatureHeader: `t=${timestamp},v1=${signature()}`,
        secret,
        nowMs: timestamp * 1000,
      }),
    ).toBe(false);
  });

  it("odmietne replay po časovej tolerancii", () => {
    expect(
      verifyEFakturaWebhook({
        rawBody,
        signatureHeader: `t=${timestamp},v1=${signature()}`,
        secret,
        nowMs: (timestamp + 301) * 1000,
      }),
    ).toBe(false);
  });

  it("odmietne neplatnú hex hodnotu bez výnimky", () => {
    expect(
      verifyEFakturaWebhook({
        rawBody,
        signatureHeader: `t=${timestamp},v1=nie-je-hex`,
        secret,
        nowMs: timestamp * 1000,
      }),
    ).toBe(false);
  });
});
