ALTER TABLE "Invoice" ADD COLUMN "consolidatedFrom" TIMESTAMP(3), ADD COLUMN "consolidatedTo" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_consolidated_period_check" CHECK (
  ("consolidatedFrom" IS NULL AND "consolidatedTo" IS NULL) OR
  ("consolidatedFrom" IS NOT NULL AND "consolidatedTo" IS NOT NULL AND "consolidatedFrom" <= "consolidatedTo")
);
CREATE TABLE "InvoiceOrder" (
  "invoiceId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "firstLineNumber" INTEGER NOT NULL,
  "lineCount" INTEGER NOT NULL,
  "deliveryDate" TIMESTAMP(3) NOT NULL,
  "buyerOrderNumber" TEXT NOT NULL,
  "deliveryNoteNumber" TEXT,
  CONSTRAINT "InvoiceOrder_pkey" PRIMARY KEY ("invoiceId", "orderId"),
  CONSTRAINT "InvoiceOrder_line_range_check" CHECK ("firstLineNumber" > 0 AND "lineCount" > 0),
  CONSTRAINT "InvoiceOrder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InvoiceOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "InvoiceOrder_orderId_idx" ON "InvoiceOrder"("orderId");
