-- eFaktúra etapa 2: auditovateľné odchádzajúce prenosy, autoritatívny zoznam
-- prijatých dokladov a idempotentná evidencia podpísaných webhookov.

CREATE TABLE "EInvoiceTransmission" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "ublDocumentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'EFAKTURA',
    "mode" TEXT NOT NULL DEFAULT 'SANDBOX',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "receiverPeppolId" TEXT NOT NULL,
    "ublSha256" TEXT NOT NULL,
    "validationIdempotencyKey" TEXT NOT NULL,
    "sendIdempotencyKey" TEXT NOT NULL,
    "providerInvoiceId" TEXT,
    "providerDocumentId" TEXT,
    "providerJobId" TEXT,
    "providerState" TEXT,
    "validationResult" JSONB,
    "lastError" TEXT,
    "validatedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "lastStatusAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EInvoiceTransmission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EInvoiceTransmission_mode_check" CHECK ("mode" IN ('SANDBOX', 'PRODUCTION')),
    CONSTRAINT "EInvoiceTransmission_status_check" CHECK (
        "status" IN ('PENDING', 'VALIDATED', 'QUEUED', 'SENT', 'DELIVERED', 'REJECTED', 'FAILED')
    ),
    CONSTRAINT "EInvoiceTransmission_ublSha256_check" CHECK ("ublSha256" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "EInvoiceReceivedDocument" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'EFAKTURA',
    "mode" TEXT NOT NULL DEFAULT 'SANDBOX',
    "providerDocumentId" TEXT NOT NULL,
    "senderPeppolId" TEXT,
    "senderName" TEXT,
    "senderIco" TEXT,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "vatTotalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "providerStatus" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "rawMetadata" JSONB,
    "xmlDocumentId" TEXT,
    "invoiceId" TEXT,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EInvoiceReceivedDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EInvoiceReceivedDocument_mode_check" CHECK ("mode" IN ('SANDBOX', 'PRODUCTION'))
);

CREATE TABLE "EInvoiceWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'EFAKTURA',
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "organizationId" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "EInvoiceWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EInvoiceTransmission_ublDocumentId_key"
    ON "EInvoiceTransmission"("ublDocumentId");
CREATE UNIQUE INDEX "EInvoiceTransmission_validationIdempotencyKey_key"
    ON "EInvoiceTransmission"("validationIdempotencyKey");
CREATE UNIQUE INDEX "EInvoiceTransmission_sendIdempotencyKey_key"
    ON "EInvoiceTransmission"("sendIdempotencyKey");
CREATE UNIQUE INDEX "EInvoiceTransmission_invoiceId_provider_mode_ublSha256_key"
    ON "EInvoiceTransmission"("invoiceId", "provider", "mode", "ublSha256");
CREATE UNIQUE INDEX "EInvoiceTransmission_provider_mode_providerInvoiceId_key"
    ON "EInvoiceTransmission"("provider", "mode", "providerInvoiceId");
CREATE INDEX "EInvoiceTransmission_status_createdAt_idx"
    ON "EInvoiceTransmission"("status", "createdAt");
CREATE INDEX "EInvoiceTransmission_invoiceId_createdAt_idx"
    ON "EInvoiceTransmission"("invoiceId", "createdAt");

CREATE UNIQUE INDEX "EInvoiceReceivedDocument_xmlDocumentId_key"
    ON "EInvoiceReceivedDocument"("xmlDocumentId");
CREATE UNIQUE INDEX "EInvoiceReceivedDocument_invoiceId_key"
    ON "EInvoiceReceivedDocument"("invoiceId");
CREATE UNIQUE INDEX "EInvoiceReceivedDocument_provider_mode_providerDocumentId_key"
    ON "EInvoiceReceivedDocument"("provider", "mode", "providerDocumentId");
CREATE INDEX "EInvoiceReceivedDocument_providerStatus_receivedAt_idx"
    ON "EInvoiceReceivedDocument"("providerStatus", "receivedAt");
CREATE INDEX "EInvoiceReceivedDocument_senderIco_documentNumber_idx"
    ON "EInvoiceReceivedDocument"("senderIco", "documentNumber");

CREATE UNIQUE INDEX "EInvoiceWebhookEvent_provider_webhookId_key"
    ON "EInvoiceWebhookEvent"("provider", "webhookId");
CREATE INDEX "EInvoiceWebhookEvent_processedAt_receivedAt_idx"
    ON "EInvoiceWebhookEvent"("processedAt", "receivedAt");
CREATE INDEX "EInvoiceWebhookEvent_eventType_receivedAt_idx"
    ON "EInvoiceWebhookEvent"("eventType", "receivedAt");

ALTER TABLE "EInvoiceTransmission"
    ADD CONSTRAINT "EInvoiceTransmission_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EInvoiceTransmission"
    ADD CONSTRAINT "EInvoiceTransmission_ublDocumentId_fkey"
    FOREIGN KEY ("ublDocumentId") REFERENCES "DocumentAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EInvoiceReceivedDocument"
    ADD CONSTRAINT "EInvoiceReceivedDocument_xmlDocumentId_fkey"
    FOREIGN KEY ("xmlDocumentId") REFERENCES "DocumentAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EInvoiceReceivedDocument"
    ADD CONSTRAINT "EInvoiceReceivedDocument_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
