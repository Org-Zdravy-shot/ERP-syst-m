-- CreateTable
CREATE TABLE "DeliveryNote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "legalEntity" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "orderId" TEXT,
    "sourceOrderHash" TEXT,
    "supplierOrderNumber" TEXT,
    "supplierOrderDate" TIMESTAMP(3),
    "buyerOrderNumber" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "issuerSnapshot" JSONB NOT NULL,
    "counterpartySnapshot" JSONB NOT NULL,
    "deliveryAddress" TEXT,
    "lines" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceDeliveryNote" (
    "invoiceId" TEXT NOT NULL,
    "deliveryNoteId" TEXT NOT NULL,
    "firstLineNumber" INTEGER NOT NULL,
    "lineCount" INTEGER NOT NULL,

    CONSTRAINT "InvoiceDeliveryNote_pkey" PRIMARY KEY ("invoiceId","deliveryNoteId")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryNote_number_key" ON "DeliveryNote"("number");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryNote_submissionKey_key" ON "DeliveryNote"("submissionKey");

-- CreateIndex
CREATE INDEX "DeliveryNote_legalEntity_deliveryDate_idx" ON "DeliveryNote"("legalEntity", "deliveryDate");

-- CreateIndex
CREATE INDEX "DeliveryNote_clientId_deliveryDate_idx" ON "DeliveryNote"("clientId", "deliveryDate");

-- CreateIndex
CREATE INDEX "DeliveryNote_orderId_idx" ON "DeliveryNote"("orderId");

-- CreateIndex
CREATE INDEX "InvoiceDeliveryNote_deliveryNoteId_idx" ON "InvoiceDeliveryNote"("deliveryNoteId");

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDeliveryNote" ADD CONSTRAINT "InvoiceDeliveryNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDeliveryNote" ADD CONSTRAINT "InvoiceDeliveryNote_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "DeliveryNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

