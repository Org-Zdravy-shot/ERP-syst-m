import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validWooSignature } from "./signature";

it("overí HMAC pôvodného tela a odmietne zmenený payload", () => {
  const secret = "test-woo-webhook-secret-32-characters-long";
  const body = '{"id":42}';
  const signature = createHmac("sha256", secret).update(body).digest("base64");
  expect(validWooSignature(body, signature, secret)).toBe(true);
  expect(validWooSignature('{"id":43}', signature, secret)).toBe(false);
  expect(validWooSignature(body, signature, undefined)).toBe(false);
});
