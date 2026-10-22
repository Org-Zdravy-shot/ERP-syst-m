import { createHmac, timingSafeEqual } from "node:crypto";
import { configuredSecret } from "@/lib/security/secrets";

export function validWooSignature(body: string, signature: string | null, secret: string | undefined): boolean {
  if (!configuredSecret(secret) || !signature) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest();
  const provided = Buffer.from(signature, "base64");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
