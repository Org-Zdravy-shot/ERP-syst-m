import { getWorkerStorage } from "@/lib/finance/outbox/composition";
import { readEFakturaConfig } from "./config";
import { EFakturaApiClient } from "./efaktura-client";
import { OutgoingEInvoiceValidationService } from "./outgoing-validation-service";
import { PrismaOutgoingEInvoiceRepository } from "./prisma-outgoing-repository";

let validationService: OutgoingEInvoiceValidationService | undefined;

/** Fail-closed: vytvorenie služby zlyhá, kým eFaktúra nie je explicitne zapnutá. */
export function getOutgoingEInvoiceValidationService(): OutgoingEInvoiceValidationService {
  if (!validationService) {
    const config = readEFakturaConfig();
    validationService = new OutgoingEInvoiceValidationService(
      config,
      new PrismaOutgoingEInvoiceRepository(),
      getWorkerStorage(),
      new EFakturaApiClient(config),
    );
  }
  return validationService;
}

export function __resetEInvoiceCompositionForTests(): void {
  validationService = undefined;
}
