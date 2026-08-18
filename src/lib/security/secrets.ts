import { timingSafeEqual } from "node:crypto";

export function configuredSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= 32;
}

export function secretMatches(
  configured: string | undefined,
  supplied: string | null | undefined,
): boolean {
  if (!configuredSecret(configured) || !supplied) return false;
  const expectedBytes = Buffer.from(configured, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}
