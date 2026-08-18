import type { EInvoiceStatus } from "@/lib/finance/contracts";
import type { EFakturaConfig } from "./config";

export type EFakturaErrorKind =
  | "AUTH"
  | "FORBIDDEN"
  | "VALIDATION"
  | "IDEMPOTENCY_CONFLICT"
  | "NOT_FOUND"
  | "RATE_LIMIT"
  | "OUTAGE"
  | "PROTOCOL";

export class EFakturaProviderError extends Error {
  constructor(
    readonly kind: EFakturaErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EFakturaProviderError";
  }
}

export interface ConnectorSendInput {
  xml: string | Uint8Array;
  idempotencyKey: string;
  receiverPeppolId?: string;
  validateOnly?: boolean;
  dispatch?: "now" | "later";
  /** Zostáva false, kým používateľ explicitne neschváli zmeny XML providerom. */
  autoRepair?: boolean;
}

export interface ConnectorValidationSummary {
  ran: boolean;
  valid: boolean;
  errorCount: number;
  warningCount: number;
}

export interface ConnectorSendResult {
  status: "QUEUED" | "REJECTED" | "VALIDATED" | "STAGED";
  providerInvoiceId?: string;
  providerDocumentId?: string;
  jobId?: string;
  stagedId?: string;
  reason?: string;
  sendReady: boolean | null;
  validatorUnavailable: boolean;
  validation?: ConnectorValidationSummary;
  repairFindings: unknown[];
  repairsApplied: unknown[];
}

export interface EFakturaTransmissionStatus {
  providerInvoiceId: string;
  status: EInvoiceStatus;
  providerState: string;
  errorMessage?: string;
  receiverIdentifier?: string;
  providerDocumentId?: string;
  updatedAt?: Date;
}

export interface EFakturaReceivedDocument {
  id: string;
  senderParticipantId?: string;
  senderName?: string;
  senderIco?: string;
  documentType: string;
  documentNumber: string;
  total: string;
  vatTotal: string;
  currency: string;
  status: string;
  issueDate?: string;
  receivedAt: Date;
}

export interface EFakturaReceivedPage {
  documents: EFakturaReceivedDocument[];
  offset: number;
  limit: number;
  nextOffset?: number;
  hasMore: boolean;
}

interface ApiEnvelope<T> {
  data?: T;
  message?: unknown;
  error?: unknown;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new EFakturaProviderError("PROTOCOL", `eFaktura.sk nevrátila platné pole ${field}.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function mapStatus(state: unknown): EInvoiceStatus {
  switch (String(state ?? "").toUpperCase()) {
    case "SENT":
      return "SENT";
    case "DELIVERED":
      return "DELIVERED";
    case "ERROR":
    case "FAILED":
      return "FAILED";
    case "REJECTED":
      return "REJECTED";
    case "NOT_SENT":
    case "QUEUED":
    case "SENDING":
    case "DEFERRED":
      return "QUEUED";
    default:
      throw new EFakturaProviderError("PROTOCOL", `Neznámy stav eFaktúry: ${String(state)}.`);
  }
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new EFakturaProviderError("PROTOCOL", "eFaktura.sk vrátila neplatný dátum.");
  }
  return date;
}

function responseDetail(body: ApiEnvelope<unknown>): string {
  if (typeof body.message === "string") return body.message;
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && "message" in body.error) {
    const message = (body.error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "bez detailu";
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export class EFakturaApiClient {
  constructor(
    private readonly config: EFakturaConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(extra: HeadersInit = {}): Headers {
    const headers = new Headers(extra);
    headers.set("X-API-Key", this.config.apiKey);
    headers.set("X-Organization-Id", this.config.organizationId);
    return headers;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.apiBase}${path}`, {
        ...init,
        headers: this.headers(init.headers),
      });
    } catch (error) {
      throw new EFakturaProviderError(
        "OUTAGE",
        `eFaktura.sk je nedostupná: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (response.ok) return response;

    const body = (await response.json().catch(() => ({}))) as ApiEnvelope<unknown>;
    const detail = responseDetail(body);
    const byStatus: Partial<Record<number, EFakturaErrorKind>> = {
      400: "VALIDATION",
      401: "AUTH",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      409: "IDEMPOTENCY_CONFLICT",
      429: "RATE_LIMIT",
    };
    const kind = byStatus[response.status] ?? (response.status >= 500 ? "OUTAGE" : "PROTOCOL");
    throw new EFakturaProviderError(kind, `eFaktura.sk API odmietlo požiadavku (${response.status}): ${detail}`, response.status);
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init);
    const body = (await response.json().catch(() => {
      throw new EFakturaProviderError("PROTOCOL", "eFaktura.sk nevrátila platný JSON.");
    })) as ApiEnvelope<T>;
    if (body.data === undefined) {
      throw new EFakturaProviderError("PROTOCOL", "eFaktura.sk odpoveď neobsahuje pole data.");
    }
    return body.data;
  }

  async sendUbl(input: ConnectorSendInput): Promise<ConnectorSendResult> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) throw new EFakturaProviderError("VALIDATION", "Idempotency key nesmie byť prázdny.");

    const xmlBytes = typeof input.xml === "string" ? Buffer.from(input.xml, "utf8") : Buffer.from(input.xml);
    if (xmlBytes.length === 0) throw new EFakturaProviderError("VALIDATION", "UBL XML nesmie byť prázdne.");

    const data = await this.requestJson<any>("/agent/peppol/connector/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        ...(input.receiverPeppolId ? { receiverPeppolId: input.receiverPeppolId } : {}),
        document: { format: "ubl", xmlBase64: xmlBytes.toString("base64") },
        options: {
          autoRepair: input.autoRepair ?? false,
          validateOnly: input.validateOnly ?? false,
          dispatch: input.dispatch ?? "now",
        },
      }),
    });

    const rawStatus = requiredString(data.status, "status").toLowerCase();
    const statusMap: Record<string, ConnectorSendResult["status"]> = {
      queued: "QUEUED",
      rejected: "REJECTED",
      validated: "VALIDATED",
      staged: "STAGED",
    };
    const status = statusMap[rawStatus];
    if (!status) throw new EFakturaProviderError("PROTOCOL", `Neznámy connector stav: ${rawStatus}.`);

    return {
      status,
      providerInvoiceId: optionalString(data.invoice_id),
      providerDocumentId: optionalString(data.document_id),
      jobId: optionalString(data.job_id),
      stagedId: optionalString(data.staged_id),
      reason: optionalString(data.reason),
      sendReady: typeof data.send_ready === "boolean" ? data.send_ready : null,
      validatorUnavailable: data.validator_unavailable === true,
      validation: data.validation
        ? {
            ran: data.validation.ran === true,
            valid: data.validation.valid === true,
            errorCount: Number(data.validation.error_count ?? 0),
            warningCount: Number(data.validation.warning_count ?? 0),
          }
        : undefined,
      repairFindings: Array.isArray(data.repair) ? data.repair : [],
      repairsApplied: Array.isArray(data.repair_applied) ? data.repair_applied : [],
    };
  }

  async getStatus(providerInvoiceId: string): Promise<EFakturaTransmissionStatus> {
    const id = encodeURIComponent(providerInvoiceId.trim());
    if (!id) throw new EFakturaProviderError("VALIDATION", "Provider invoice ID nesmie byť prázdne.");
    const data = await this.requestJson<any>(`/agent/peppol/status/${id}`);
    const providerState = requiredString(data.state, "state");
    return {
      providerInvoiceId: optionalString(data.invoice_id) ?? providerInvoiceId,
      status: mapStatus(providerState),
      providerState,
      errorMessage: optionalString(data.error_message),
      receiverIdentifier: optionalString(data.receiver_identifier),
      providerDocumentId: optionalString(data.document_id),
      updatedAt: parseDate(data.updated_at),
    };
  }

  async listReceived(offset = 0, limit = 50): Promise<EFakturaReceivedPage> {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new EFakturaProviderError("VALIDATION", "Offset musí byť nezáporné celé číslo.");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new EFakturaProviderError("VALIDATION", "Limit musí byť celé číslo od 1 do 100.");
    }
    const data = await this.requestJson<any[]>(`/agent/peppol/received?limit=${limit}&offset=${offset}`);
    if (!Array.isArray(data)) throw new EFakturaProviderError("PROTOCOL", "Zoznam prijatých dokladov nie je pole.");

    const documents = data.map((item) => ({
      id: requiredString(item.id, "id"),
      senderParticipantId: optionalString(item.sender_participant_id),
      senderName: optionalString(item.sender_name),
      senderIco: optionalString(item.sender_ico),
      documentType: requiredString(item.document_type, "document_type"),
      documentNumber: requiredString(item.document_number, "document_number"),
      total: requiredString(item.total, "total"),
      vatTotal: requiredString(item.vat_total, "vat_total"),
      currency: requiredString(item.currency, "currency"),
      status: requiredString(item.status, "status"),
      issueDate: optionalString(item.issue_date),
      receivedAt: parseDate(item.received_at) ?? (() => {
        throw new EFakturaProviderError("PROTOCOL", "Prijatý doklad nemá received_at.");
      })(),
    }));
    const hasMore = documents.length === limit;
    return { documents, offset, limit, hasMore, nextOffset: hasMore ? offset + documents.length : undefined };
  }

  async downloadReceivedXml(documentId: string): Promise<Uint8Array> {
    const id = encodeURIComponent(documentId.trim());
    if (!id) throw new EFakturaProviderError("VALIDATION", "ID prijatého dokladu nesmie byť prázdne.");
    const response = await this.request(`/agent/peppol/received/${id}/xml`);
    return new Uint8Array(await response.arrayBuffer());
  }
}
