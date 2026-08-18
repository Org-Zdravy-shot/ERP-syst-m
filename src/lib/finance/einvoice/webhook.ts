import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyEFakturaWebhookInput {
  rawBody: string | Uint8Array;
  signatureHeader: string;
  secret: string;
  toleranceSeconds?: number;
  nowMs?: number;
}

/** Overí raw telo; JSON sa smie parsovať až po úspešnom overení. */
export function verifyEFakturaWebhook(input: VerifyEFakturaWebhookInput): boolean {
  const tolerance = input.toleranceSeconds ?? 300;
  if (!input.secret || !Number.isFinite(tolerance) || tolerance < 0) return false;

  const parts = input.signatureHeader.split(",").map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const timestamp = Number(timestampPart?.slice(2));
  if (!Number.isInteger(timestamp) || timestamp <= 0) return false;

  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false;

  const rawBody = typeof input.rawBody === "string" ? input.rawBody : Buffer.from(input.rawBody);
  const expected = createHmac("sha256", input.secret)
    .update(String(timestamp))
    .update(".")
    .update(rawBody)
    .digest();

  return parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .some((signature) => {
      if (!/^[0-9a-fA-F]{64}$/.test(signature)) return false;
      const received = Buffer.from(signature, "hex");
      return received.length === expected.length && timingSafeEqual(received, expected);
    });
}
