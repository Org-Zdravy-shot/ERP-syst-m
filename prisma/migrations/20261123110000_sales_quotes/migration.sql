-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "quoteId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "quoteId" TEXT;

-- AlterTable
ALTER TABLE "DeliveryNote" ADD COLUMN     "quoteId" TEXT;

-- CreateTable
CREATE TABLE "SalesQuote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "legalEntity" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "issuerSnapshot" JSONB NOT NULL,
    "counterpartySnapshot" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "totalNetCents" INTEGER NOT NULL,
    "totalVatCents" INTEGER NOT NULL,
    "totalGrossCents" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesQuote_number_key" ON "SalesQuote"("number");

-- CreateIndex
CREATE UNIQUE INDEX "SalesQuote_submissionKey_key" ON "SalesQuote"("submissionKey");

-- CreateIndex
CREATE INDEX "SalesQuote_legalEntity_issueDate_idx" ON "SalesQuote"("legalEntity", "issueDate");

-- CreateIndex
CREATE INDEX "SalesQuote_clientId_issueDate_idx" ON "SalesQuote"("clientId", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");

-- CreateIndex
CREATE INDEX "Invoice_quoteId_idx" ON "Invoice"("quoteId");

-- CreateIndex
CREATE INDEX "DeliveryNote_quoteId_idx" ON "DeliveryNote"("quoteId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SalesQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SalesQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SalesQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuote" ADD CONSTRAINT "SalesQuote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
