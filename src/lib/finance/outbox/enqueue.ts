import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface EnqueueInput {
  type: string;
  aggregateType: string;
  aggregateId: string;
  idempotencyKey: string;
  payload: Prisma.InputJsonValue;
  availableAt?: Date;
}

export interface EnqueueResult {
  created: boolean;
  eventId: string;
}

/**
 * Idempotentné zaradenie outbox udalosti. Rovnaký idempotencyKey (napr.
 * pre auto e-mail po finalizácii) sa nezaradí dvakrát — vráti existujúcu.
 */
export async function enqueueOutbox(
  input: EnqueueInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<EnqueueResult> {
  const existing = await client.outboxEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existing) return { created: false, eventId: existing.id };

  try {
    const event = await client.outboxEvent.create({
      data: {
        type: input.type,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        availableAt: input.availableAt ?? new Date(),
      },
      select: { id: true },
    });
    return { created: true, eventId: event.id };
  } catch (e) {
    // súbeh — kľúč medzitým vznikol
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      const race = await client.outboxEvent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (race) return { created: false, eventId: race.id };
    }
    throw e;
  }
}
