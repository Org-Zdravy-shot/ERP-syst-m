import { describe, expect, it, vi } from "vitest";
import type { EFakturaConfig } from "./config";
import { EFakturaApiClient, EFakturaProviderError } from "./efaktura-client";

const config: EFakturaConfig = {
  apiBase: "https://api.efaktura.test/v1",
  apiKey: "efk_pk_test_example",
  organizationId: "org-1",
  mode: "sandbox",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("EFakturaApiClient — connector", () => {
  it("odošle ERP UBL s povinnou idempotenciou a bez auto-opravy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        data: {
          status: "queued",
          invoice_id: "invoice-1",
          document_id: "0245:123#2026009",
          job_id: "job-1",
          send_ready: true,
          validator_unavailable: false,
          validation: { ran: true, valid: true, error_count: 0, warning_count: 1 },
          repair: [],
          repair_applied: [],
        },
      }),
    );
    const client = new EFakturaApiClient(config, fetchMock as unknown as typeof fetch);

    const result = await client.sendUbl({
      xml: "<Invoice>2026009</Invoice>",
      idempotencyKey: "einvoice/invoice-db-id/hash-1",
      receiverPeppolId: "0245:2123456789",
    });

    expect(result).toMatchObject({
      status: "QUEUED",
      providerInvoiceId: "invoice-1",
      providerDocumentId: "0245:123#2026009",
      sendReady: true,
      repairsApplied: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.efaktura.test/v1/agent/peppol/connector/send");
    const headers = new Headers(init.headers);
    expect(headers.get("X-API-Key")).toBe(config.apiKey);
    expect(headers.get("X-Organization-Id")).toBe(config.organizationId);
    expect(headers.get("Idempotency-Key")).toBe("einvoice/invoice-db-id/hash-1");
    const body = JSON.parse(String(init.body));
    expect(Buffer.from(body.document.xmlBase64, "base64").toString("utf8")).toBe("<Invoice>2026009</Invoice>");
    expect(body.options).toEqual({ autoRepair: false, validateOnly: false, dispatch: "now" });
  });

  it("vráti validačné zamietnutie ako doménový výsledok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        data: {
          status: "rejected",
          reason: "validation",
          send_ready: false,
          validation: { ran: true, valid: false, error_count: 2, warning_count: 0 },
          repair: [{ code: "BT-35" }],
        },
      }),
    );
    const client = new EFakturaApiClient(config, fetchMock as unknown as typeof fetch);

    const result = await client.sendUbl({ xml: "<Invoice />", idempotencyKey: "stable-1", validateOnly: true });
    expect(result.status).toBe("REJECTED");
    expect(result.reason).toBe("validation");
    expect(result.validation?.errorCount).toBe(2);
    expect(result.repairFindings).toEqual([{ code: "BT-35" }]);
  });

  it("rozlíši konflikt idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(409, { message: "key used with different body" }));
    const client = new EFakturaApiClient(config, fetchMock as unknown as typeof fetch);

    await expect(client.sendUbl({ xml: "<Invoice />", idempotencyKey: "stable-1" })).rejects.toMatchObject({
      kind: "IDEMPOTENCY_CONFLICT",
      status: 409,
    });
  });

  it("odmietne prázdny XML ešte pred sieťovým volaním", async () => {
    const fetchMock = vi.fn();
    const client = new EFakturaApiClient(config, fetchMock as unknown as typeof fetch);
    await expect(client.sendUbl({ xml: "", idempotencyKey: "stable-1" })).rejects.toBeInstanceOf(
      EFakturaProviderError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("EFakturaApiClient — stavy a prijaté doklady", () => {
  it("mapuje dočasný provider stav DEFERRED na QUEUED", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        data: {
          invoice_id: "invoice-1",
          state: "DEFERRED",
          document_id: "doc-1",
          updated_at: "2026-08-18T10:00:00.000Z",
        },
      }),
    );
    const client = new EFakturaApiClient(config, fetchMock as unknown as typeof fetch);

    const result = await client.getStatus("invoice-1");
    expect(result.status).toBe("QUEUED");
    expect(result.providerState).toBe("DEFERRED");
    expect(result.updatedAt?.toISOString()).toBe("2026-08-18T10:00:00.000Z");
  });

  it("stránkuje prijaté doklady a stiahne pôvodné XML", async () => {
    const received = Array.from({ length: 2 }, (_, index) => ({
      id: `received-${index + 1}`,
      sender_participant_id: "9915:2020202020",
      sender_name: "Dodávateľ",
      sender_ico: "12345678",
      document_type: "invoice",
      document_number: `VF-${index + 1}`,
      total: "123.00",
      vat_total: "23.00",
      currency: "EUR",
      status: "new",
      issue_date: "2026-08-18",
      received_at: "2026-08-18T11:00:00.000Z",
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { data: received }))
      .mockResolvedValueOnce(new Response("<Invoice />", { status: 200, headers: { "Content-Type": "application/xml" } }));
    const client = new EFakturaApiClient(config, fetchMock as unknown as typeof fetch);

    const page = await client.listReceived(10, 2);
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(12);
    expect(page.documents[0].documentNumber).toBe("VF-1");

    const xml = await client.downloadReceivedXml("received-1");
    expect(Buffer.from(xml).toString("utf8")).toBe("<Invoice />");
    expect(String(fetchMock.mock.calls[0][0])).toContain("limit=2&offset=10");
  });

  it("sieťový výpadok označí ako OUTAGE", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("timeout"));
    const client = new EFakturaApiClient(config, fetchMock as unknown as typeof fetch);
    await expect(client.getStatus("invoice-1")).rejects.toMatchObject({ kind: "OUTAGE" });
  });
});
