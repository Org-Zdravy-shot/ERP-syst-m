import type { Prisma } from "@prisma/client";

// Both new-client entry points share this lock, including whitespace-normalized legacy ICOs.
export async function findClientByIcoForCreation(tx: Prisma.TransactionClient, ico: string) {
  const normalized = ico.replace(/\s/g, "");
  if (!normalized) return null;
  // PostgreSQL returns void; cast it so Prisma can deserialize the result.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-client:${normalized}`}))::text`;
  const matches = await tx.$queryRaw<Array<{ id: string; name: string; type: string; isActive: boolean }>>`
    SELECT "id", "name", "type", "isActive" FROM "Client"
    WHERE regexp_replace(COALESCE("ico", ''), '[[:space:]]', '', 'g') = ${normalized}
    ORDER BY "isActive" DESC, "id" ASC LIMIT 2
  `;
  if (matches.length > 1) throw new Error("V adresári je viac klientov s týmto IČO. Vyberte správneho klienta z existujúceho zoznamu.");
  return matches[0] ?? null;
}
