import type { DocumentObjectStorage } from "@/lib/finance/documents/types";
import type { EFakturaConfig } from "./config";
import {
  EFakturaProviderError,
  type ConnectorSendResult,
  type EFakturaRecipientLookup,
} from "./efaktura-client";
import type {
  OutgoingEInvoiceRepository,
  OutgoingEInvoiceStatus,
} from "./outgoing-repository";
import { slovakPeppolEndpoint } from "./peppol-id";
import { renderPeppolBisUbl } from "./ubl";

const XML_CONTENT_TYPE = "application/xml";

export interface EInvoiceValidationProvider {
  lookupRecipient(peppolId: string): Promise<EFakturaRecipientLookup>;
  sendUbl(input: {
    xml: string | Uint8Array;
    idempotencyKey: string;
    receiverPeppolId: string;
    validateOnly: true;
    dispatch: "now";
    autoRepair: false;
  }): Promise<ConnectorSendResult>;
}

export interface OutgoingEInvoiceValidationResult {
  transmissionId: string;
  ublDocumentId: string;
  ublSha256: string;
  receiverPeppolId: string;
  status: OutgoingEInvoiceStatus;
  recipientFound?: boolean;
  lookupUnavailable?: boolean;
  reused: boolean;
}

function safeInvoiceNumber(value: string): string {
  return (
    value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "doklad"
  );
}

function providerValidationAccepted(result: ConnectorSendResult): boolean {
  return (
    result.status === "VALIDATED" &&
    result.validatorUnavailable === false &&
    result.sendReady === true &&
    result.validation?.ran === true &&
    result.validation.valid === true &&
    result.validation.errorCount === 0 &&
    result.repairsApplied.length === 0
  );
}

export class OutgoingEInvoiceValidationService {
  constructor(
    private readonly config: EFakturaConfig,
    private readonly repository: OutgoingEInvoiceRepository,
    private readonly storage: DocumentObjectStorage,
    private readonly provider: EInvoiceValidationProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async prepareAndValidate(
    invoiceId: string,
    actorId: string,
  ): Promise<OutgoingEInvoiceValidationResult> {
    const invoice = await this.repository.getInvoiceData(invoiceId);
    if (!invoice) throw new Error("Faktúra sa nenašla.");
    if (!invoice.buyerReference?.trim()) {
      throw new Error(
        "Faktúre chýba číslo objednávky kupujúceho pre Peppol BuyerReference.",
      );
    }
    if (!invoice.issuer.dic || !invoice.counterparty.dic) {
      throw new Error(
        "eFaktúra vyžaduje DIČ predávajúceho aj kupujúceho v nemennom snapshot-e.",
      );
    }

    const seller = slovakPeppolEndpoint(invoice.issuer.dic, this.config.mode);
    const buyer = slovakPeppolEndpoint(
      invoice.counterparty.dic,
      this.config.mode,
    );
    const rendered = renderPeppolBisUbl({
      ...invoice,
      sellerEndpoint: seller,
      buyerEndpoint: buyer,
      buyerReference: invoice.buyerReference,
    });
    const objectKey = `finance/invoices/${invoice.id}/einvoice/${rendered.sha256}.xml`;
    await this.storage.putImmutable({
      objectKey,
      contentType: XML_CONTENT_TYPE,
      bytes: rendered.bytes,
      sha256: rendered.sha256,
    });

    const prepared = await this.repository.savePrepared({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      mode: this.config.mode,
      receiverPeppolId: rendered.receiverPeppolId,
      ublSha256: rendered.sha256,
      validationIdempotencyKey: rendered.validationIdempotencyKey,
      sendIdempotencyKey: rendered.idempotencyKey,
      objectKey,
      fileName: `efaktura-${safeInvoiceNumber(invoice.invoiceNumber)}.xml`,
      contentType: XML_CONTENT_TYPE,
      byteSize: rendered.bytes.byteLength,
      storageProvider: this.storage.provider,
      bucket: this.storage.bucket,
      actorId,
    });

    if (prepared.status !== "PENDING") {
      const validation = prepared.validationResult as
        | { recipient?: Partial<EFakturaRecipientLookup> }
        | undefined;
      return {
        transmissionId: prepared.id,
        ublDocumentId: prepared.ublDocumentId,
        ublSha256: prepared.ublSha256,
        receiverPeppolId: prepared.receiverPeppolId,
        status: prepared.status,
        recipientFound: validation?.recipient?.found,
        lookupUnavailable: validation?.recipient?.lookupUnavailable,
        reused: true,
      };
    }

    try {
      const recipient = await this.provider.lookupRecipient(
        rendered.receiverPeppolId,
      );
      const connector = await this.provider.sendUbl({
        xml: rendered.bytes,
        idempotencyKey: rendered.validationIdempotencyKey,
        receiverPeppolId: rendered.receiverPeppolId,
        validateOnly: true,
        dispatch: "now",
        autoRepair: false,
      });
      if (connector.validatorUnavailable) {
        throw new EFakturaProviderError(
          "OUTAGE",
          "Validátor eFaktúry je dočasne nedostupný.",
        );
      }
      if (connector.status !== "VALIDATED" && connector.status !== "REJECTED") {
        throw new EFakturaProviderError(
          "PROTOCOL",
          "Provider v režime validateOnly vrátil neočakávaný stav.",
        );
      }

      const accepted = providerValidationAccepted(connector);
      const saved = await this.repository.recordValidation({
        transmissionId: prepared.id,
        accepted,
        connector,
        recipient,
        checkedAt: this.now(),
      });
      return {
        transmissionId: saved.id,
        ublDocumentId: saved.ublDocumentId,
        ublSha256: saved.ublSha256,
        receiverPeppolId: saved.receiverPeppolId,
        status: saved.status,
        recipientFound: recipient.found,
        lookupUnavailable: recipient.lookupUnavailable,
        reused: false,
      };
    } catch (error) {
      await this.repository.recordAttemptError(
        prepared.id,
        error instanceof Error ? error.message : String(error),
        this.now(),
      );
      throw error;
    }
  }
}
