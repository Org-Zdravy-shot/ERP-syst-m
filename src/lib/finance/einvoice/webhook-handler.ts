import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { EFakturaMode } from "./config";

const eventTypeSchema = z.enum([
  "peppol.document.sent",
  "peppol.document.delivered",
  "peppol.document.failed",
  "peppol.document.received",
  "usage.limit_exceeded",
]);

const envelopeSchema = z.object({
  event: eventTypeSchema,
  timestamp: z.iso.datetime({ offset: true }),
  data: z.object({
    orgId: z.string().trim().min(1),
    mode: z.string().trim().optional(),
  }).loose(),
}).loose();

export type EFakturaWebhookEventType = z.infer<typeof eventTypeSchema>;

export interface ParsedEFakturaWebhook {
  event: EFakturaWebhookEventType;
  occurredAt: Date;
  organizationId: string;
  data: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface EFakturaTransmissionUpdate {
  providerInvoiceId: string;
  status: "SENT" | "DELIVERED" | "FAILED";
  providerState: string;
  lastStatusAt: Date;
  deliveredAt?: Date;
  lastError?: string;
}

export class EFakturaWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EFakturaWebhookError";
  }
}

export function parseEFakturaWebhookPayload(input: {
  rawBody: string;
  headerEvent: string;
  expectedOrganizationId: string;
  mode: EFakturaMode;
}): ParsedEFakturaWebhook {
  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    throw new EFakturaWebhookError("Webhook neobsahuje platný JSON.");
  }
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) throw new EFakturaWebhookError("Webhook nemá platnú obálku event/timestamp/data.");
  if (parsed.data.event !== input.headerEvent) {
    throw new EFakturaWebhookError("Názov eventu v hlavičke a tele sa nezhoduje.");
  }
  if (parsed.data.data.orgId !== input.expectedOrganizationId) {
    throw new EFakturaWebhookError("Webhook patrí inej organizácii.");
  }
  if (input.mode === "sandbox" && parsed.data.data.mode && parsed.data.data.mode !== "test") {
    throw new EFakturaWebhookError("Sandbox webhook nemá testovací režim.");
  }
  if (input.mode === "production" && parsed.data.data.mode === "test") {
    throw new EFakturaWebhookError("Testovací webhook nemožno spracovať ako produkčný.");
  }

  return {
    event: parsed.data.event,
    occurredAt: new Date(parsed.data.timestamp),
    organizationId: parsed.data.data.orgId,
    data: parsed.data.data,
    payload: parsed.data,
  };
}

function requiredProviderInvoiceId(data: Record<string, unknown>): string {
  const value = data.invoiceId;
  if (typeof value !== "string" || !value.trim()) {
    throw new EFakturaWebhookError("Stavový webhook neobsahuje provider invoiceId.");
  }
  return value.trim();
}

export function transmissionUpdateForWebhook(
  webhook: ParsedEFakturaWebhook,
): EFakturaTransmissionUpdate | null {
  const providerState = typeof webhook.data.state === "string"
    ? webhook.data.state.trim().toUpperCase()
    : webhook.event.split(".").at(-1)?.toUpperCase() ?? "";

  switch (webhook.event) {
    case "peppol.document.sent":
      return {
        providerInvoiceId: requiredProviderInvoiceId(webhook.data),
        status: "SENT",
        providerState: providerState || "SENT",
        lastStatusAt: webhook.occurredAt,
      };
    case "peppol.document.delivered":
      return {
        providerInvoiceId: requiredProviderInvoiceId(webhook.data),
        status: "DELIVERED",
        providerState: providerState || "DELIVERED",
        lastStatusAt: webhook.occurredAt,
        deliveredAt: webhook.occurredAt,
      };
    case "peppol.document.failed":
      return {
        providerInvoiceId: requiredProviderInvoiceId(webhook.data),
        status: "FAILED",
        providerState: providerState || "FAILED",
        lastStatusAt: webhook.occurredAt,
        lastError: typeof webhook.data.error === "string" && webhook.data.error.trim()
          ? webhook.data.error.trim()
          : "Poskytovateľ oznámil finálne zlyhanie prenosu.",
      };
    case "peppol.document.received":
    case "usage.limit_exceeded":
      return null;
  }
}

export interface PersistEFakturaWebhookResult {
  eventId: string;
  status: "processed" | "pending" | "duplicate";
}

export function shouldApplyTransmissionWebhook(
  currentStatus: string,
  nextStatus: EFakturaTransmissionUpdate["status"],
): boolean {
  if (currentStatus === "DELIVERED") return nextStatus === "DELIVERED";
  if (currentStatus === "FAILED" || currentStatus === "REJECTED") {
    return currentStatus === nextStatus;
  }
  if (nextStatus === "SENT" && currentStatus === "SENT") return true;
  return true;
}

/**
 * Uloží iba už kryptograficky overený payload. Rovnaký webhook ID sa môže
 * bezpečne zopakovať; pending event sa pri retry pokúsi spracovať znovu.
 */
export async function persistEFakturaWebhook(input: {
  webhookId: string;
  mode: EFakturaMode;
  webhook: ParsedEFakturaWebhook;
}): Promise<PersistEFakturaWebhookResult> {
  const mode = input.mode === "sandbox" ? "SANDBOX" : "PRODUCTION";
  const payload = JSON.parse(JSON.stringify(input.webhook.payload)) as Prisma.InputJsonValue;

  return prisma.$transaction(async (tx) => {
    const record = await tx.eInvoiceWebhookEvent.upsert({
      where: { provider_webhookId: { provider: "EFAKTURA", webhookId: input.webhookId } },
      create: {
        provider: "EFAKTURA",
        webhookId: input.webhookId,
        eventType: input.webhook.event,
        organizationId: input.webhook.organizationId,
        payload,
      },
      update: {},
    });
    if (record.processedAt) return { eventId: record.id, status: "duplicate" };

    const update = transmissionUpdateForWebhook(input.webhook);
    if (update) {
      const transmission = await tx.eInvoiceTransmission.findUnique({
        where: {
          provider_mode_providerInvoiceId: {
            provider: "EFAKTURA",
            mode,
            providerInvoiceId: update.providerInvoiceId,
          },
        },
        select: { id: true, status: true },
      });
      if (!transmission) {
        await tx.eInvoiceWebhookEvent.update({
          where: { id: record.id },
          data: { processingError: "Prenos ešte nie je v ERP; čaká na opakované spracovanie alebo polling." },
        });
        return { eventId: record.id, status: "pending" };
      }
      if (shouldApplyTransmissionWebhook(transmission.status, update.status)) {
        await tx.eInvoiceTransmission.update({
          where: { id: transmission.id },
          data: {
          status: update.status,
          providerState: update.providerState,
          lastStatusAt: update.lastStatusAt,
          ...(update.deliveredAt ? { deliveredAt: update.deliveredAt } : {}),
          ...(update.lastError ? { lastError: update.lastError } : {}),
          },
        });
      }
    }

    await tx.eInvoiceWebhookEvent.update({
      where: { id: record.id },
      data: { processedAt: new Date(), processingError: null },
    });
    return { eventId: record.id, status: "processed" };
  });
}
