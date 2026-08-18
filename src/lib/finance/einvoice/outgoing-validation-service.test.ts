import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInvoicePdfFixture } from "@/lib/finance/documents/test-fixtures";
import { InMemoryDocumentStorage } from "@/lib/finance/outbox/local-storage";
import type { EFakturaConfig } from "./config";
import { EFakturaProviderError } from "./efaktura-client";
import type {
  OutgoingEInvoiceRepository,
  PreparedEInvoiceRecord,
} from "./outgoing-repository";
import { OutgoingEInvoiceValidationService } from "./outgoing-validation-service";

const config: EFakturaConfig = {
  apiBase: "https://api.efaktura.test/v1",
  apiKey: "efk_pk_test_example",
  organizationId: "org-1",
  mode: "sandbox",
};

function prepared(
  overrides: Partial<PreparedEInvoiceRecord> = {},
): PreparedEInvoiceRecord {
  return {
    id: "transmission-1",
    status: "PENDING",
    ublDocumentId: "document-1",
    receiverPeppolId: "9915:2198765432",
    ublSha256: "placeholder",
    validationIdempotencyKey: "validate-key",
    sendIdempotencyKey: "send-key",
    ...overrides,
  };
}

function createRepository() {
  let current = prepared();
  const repository: OutgoingEInvoiceRepository = {
    getInvoiceData: vi.fn().mockResolvedValue(
      createInvoicePdfFixture({ buyerReference: "OBJ2026-0042" }),
    ),
    savePrepared: vi.fn().mockImplementation(async (input) => {
      current = prepared({
        status: current.status,
        ublSha256: input.ublSha256,
        receiverPeppolId: input.receiverPeppolId,
        validationIdempotencyKey: input.validationIdempotencyKey,
        sendIdempotencyKey: input.sendIdempotencyKey,
        validationResult: current.validationResult,
      });
      return current;
    }),
    recordValidation: vi.fn().mockImplementation(async (input) => {
      current = {
        ...current,
        status: input.accepted ? "VALIDATED" : "REJECTED",
        validationResult: {
          recipient: input.recipient,
          connector: input.connector,
        },
      };
      return current;
    }),
    recordAttemptError: vi.fn().mockResolvedValue(undefined),
  };
  return { repository, setCurrent: (value: PreparedEInvoiceRecord) => (current = value) };
}

const validConnector = {
  status: "VALIDATED" as const,
  sendReady: true,
  validatorUnavailable: false,
  validation: { ran: true, valid: true, errorCount: 0, warningCount: 0 },
  repairFindings: [],
  repairsApplied: [],
};

describe("OutgoingEInvoiceValidationService", () => {
  let storage: InMemoryDocumentStorage;

  beforeEach(() => {
    storage = new InMemoryDocumentStorage();
  });

  it("uloží nemenné UBL a providerovi pošle iba validačný request", async () => {
    const { repository } = createRepository();
    const provider = {
      lookupRecipient: vi.fn().mockResolvedValue({
        peppolId: "9915:2198765432",
        found: true,
        lookupUnavailable: false,
      }),
      sendUbl: vi.fn().mockResolvedValue(validConnector),
    };
    const service = new OutgoingEInvoiceValidationService(
      config,
      repository,
      storage,
      provider,
      () => new Date("2026-08-18T14:00:00.000Z"),
    );

    const result = await service.prepareAndValidate(
      "invoice-test-1",
      "admin-1",
    );

    expect(result).toMatchObject({
      status: "VALIDATED",
      receiverPeppolId: "9915:2198765432",
      recipientFound: true,
      reused: false,
    });
    expect(provider.sendUbl).toHaveBeenCalledWith(
      expect.objectContaining({
        receiverPeppolId: "9915:2198765432",
        validateOnly: true,
        dispatch: "now",
        autoRepair: false,
      }),
    );
    const savedInput = vi.mocked(repository.savePrepared).mock.calls[0][0];
    expect(savedInput.contentType).toBe("application/xml");
    expect(savedInput.storageProvider).toBe("IN_MEMORY");
    const object = await storage.getObject(savedInput.objectKey);
    expect(object.byteSize).toBe(savedInput.byteSize);
    expect(object.sha256).toBe(savedInput.ublSha256);
    expect(Buffer.from(object.bytes).toString("utf8")).toContain(
      "<cbc:BuyerReference>OBJ2026-0042</cbc:BuyerReference>",
    );
  });

  it("uloží zamietnutú validáciu bez pokusu o ostré odoslanie", async () => {
    const { repository } = createRepository();
    const provider = {
      lookupRecipient: vi.fn().mockResolvedValue({
        peppolId: "9915:2198765432",
        found: false,
        lookupUnavailable: false,
      }),
      sendUbl: vi.fn().mockResolvedValue({
        ...validConnector,
        status: "REJECTED" as const,
        reason: "validation",
        sendReady: false,
        validation: {
          ran: true,
          valid: false,
          errorCount: 1,
          warningCount: 0,
        },
      }),
    };
    const service = new OutgoingEInvoiceValidationService(
      config,
      repository,
      storage,
      provider,
    );

    const result = await service.prepareAndValidate(
      "invoice-test-1",
      "admin-1",
    );

    expect(result.status).toBe("REJECTED");
    expect(result.recipientFound).toBe(false);
    expect(repository.recordValidation).toHaveBeenCalledWith(
      expect.objectContaining({ accepted: false }),
    );
    expect(provider.sendUbl).toHaveBeenCalledOnce();
  });

  it("pri už validovanom rovnakom hash-i providerovi nevolá druhýkrát", async () => {
    const { repository, setCurrent } = createRepository();
    setCurrent(
      prepared({
        status: "VALIDATED",
        validationResult: {
          recipient: { found: true, lookupUnavailable: false },
        },
      }),
    );
    const provider = {
      lookupRecipient: vi.fn(),
      sendUbl: vi.fn(),
    };
    const service = new OutgoingEInvoiceValidationService(
      config,
      repository,
      storage,
      provider,
    );

    const result = await service.prepareAndValidate(
      "invoice-test-1",
      "admin-1",
    );

    expect(result).toMatchObject({
      status: "VALIDATED",
      recipientFound: true,
      reused: true,
    });
    expect(provider.lookupRecipient).not.toHaveBeenCalled();
    expect(provider.sendUbl).not.toHaveBeenCalled();
  });

  it("bez skutočnej referencie kupujúceho UBL nevytvorí", async () => {
    const { repository } = createRepository();
    vi.mocked(repository.getInvoiceData).mockResolvedValue(
      createInvoicePdfFixture({ buyerReference: undefined }),
    );
    const provider = { lookupRecipient: vi.fn(), sendUbl: vi.fn() };
    const service = new OutgoingEInvoiceValidationService(
      config,
      repository,
      storage,
      provider,
    );

    await expect(
      service.prepareAndValidate("invoice-test-1", "admin-1"),
    ).rejects.toThrow(/BuyerReference/);
    expect(repository.savePrepared).not.toHaveBeenCalled();
    expect(provider.lookupRecipient).not.toHaveBeenCalled();
  });

  it("výpadok validátora zapíše k čakajúcemu prenosu na retry", async () => {
    const { repository } = createRepository();
    const provider = {
      lookupRecipient: vi.fn().mockResolvedValue({
        peppolId: "9915:2198765432",
        found: true,
        lookupUnavailable: false,
      }),
      sendUbl: vi.fn().mockResolvedValue({
        ...validConnector,
        sendReady: null,
        validatorUnavailable: true,
      }),
    };
    const now = new Date("2026-08-18T14:00:00.000Z");
    const service = new OutgoingEInvoiceValidationService(
      config,
      repository,
      storage,
      provider,
      () => now,
    );

    await expect(
      service.prepareAndValidate("invoice-test-1", "admin-1"),
    ).rejects.toBeInstanceOf(EFakturaProviderError);
    expect(repository.recordAttemptError).toHaveBeenCalledWith(
      "transmission-1",
      "Validátor eFaktúry je dočasne nedostupný.",
      now,
    );
  });
});
